import logging
from unittest.mock import call, patch
from uuid import uuid4

import pendulum
import pytest

from app.models.card.specs import CommentCardSpec, PostLikesCardSpec, PostViewsCardSpec
from app.models.like.enums import LikeStatus
from app.models.post.enums import PostStatus, PostType


@pytest.fixture
def user(user_manager, cognito_client):
    user_id, username = str(uuid4()), str(uuid4())[:8]
    cognito_client.create_verified_user_pool_entry(user_id, username, f'{username}@real.app')
    yield user_manager.create_cognito_only_user(user_id, username)


user2 = user


@pytest.fixture
def post(post_manager, user):
    yield post_manager.add_post(user, str(uuid4()), PostType.TEXT_ONLY, text='go go')


@pytest.fixture
def like_onymous_new(post, user, like_manager):
    like_manager.like_post(user, post, LikeStatus.ONYMOUSLY_LIKED)
    yield like_manager.get_like(user.id, post.id)


@pytest.fixture
def like_anonymous_new(post, user2, like_manager):
    like_manager.like_post(user2, post, LikeStatus.ANONYMOUSLY_LIKED)
    yield like_manager.get_like(user2.id, post.id)


@pytest.fixture
def like_onymous_old(post, user, like_manager):
    like_manager.dynamo.add_like(user.id, post.item, LikeStatus.ONYMOUSLY_LIKED, old_pk_format=True)
    yield like_manager.get_like(user.id, post.id)


@pytest.fixture
def like_anonymous_old(post, user2, like_manager):
    like_manager.dynamo.add_like(user2.id, post.item, LikeStatus.ANONYMOUSLY_LIKED, old_pk_format=True)
    yield like_manager.get_like(user2.id, post.id)


def test_on_flag_added(post_manager, post, user2):
    # check starting state
    assert post.refresh_item().item.get('flagCount', 0) == 0

    # postprocess, verify flagCount is incremented & not force achived
    post_manager.on_flag_added(post.id, user2.id)
    assert post.refresh_item().item.get('flagCount', 0) == 1
    assert post.status != PostStatus.ARCHIVED


def test_on_flag_added_force_archive_by_admin(post_manager, post, user2, caplog):
    # configure and check starting state
    assert post.refresh_item().item.get('flagCount', 0) == 0
    user2.update_username(post.flag_admin_usernames[0])

    # postprocess, verify flagCount is incremented and force archived
    with caplog.at_level(logging.WARNING):
        post_manager.on_flag_added(post.id, user2.id)
    assert len(caplog.records) == 1
    assert 'Force archiving post' in caplog.records[0].msg
    assert post.refresh_item().item.get('flagCount', 0) == 1
    assert post.status == PostStatus.ARCHIVED


def test_on_flag_added_force_archive_by_crowdsourced_criteria(post_manager, post, user2, caplog):
    # configure and check starting state
    assert post.refresh_item().item.get('flagCount', 0) == 0
    for _ in range(6):
        post.dynamo.increment_viewed_by_count(post.id)

    # postprocess, verify flagCount is incremented and force archived
    with caplog.at_level(logging.WARNING):
        post_manager.on_flag_added(post.id, user2.id)
    assert len(caplog.records) == 1
    assert 'Force archiving post' in caplog.records[0].msg
    assert post.refresh_item().item.get('flagCount', 0) == 1
    assert post.status == PostStatus.ARCHIVED


@pytest.mark.parametrize(
    'like_onymous, like_anonymous',
    [
        pytest.lazy_fixture(['like_onymous_new', 'like_anonymous_new']),
        pytest.lazy_fixture(['like_onymous_old', 'like_anonymous_old']),
    ],
)
def test_on_like_add(post_manager, post, like_onymous, like_anonymous):
    # check starting state
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 0
    assert post.item.get('anonymousLikeCount', 0) == 0

    # trigger, check state
    post_manager.on_like_add('unused', like_onymous.item)
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 1
    assert post.item.get('anonymousLikeCount', 0) == 0

    # trigger, check state
    post_manager.on_like_add('unused', like_anonymous.item)
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 1
    assert post.item.get('anonymousLikeCount', 0) == 1

    # trigger, check state
    post_manager.on_like_add('unused', like_anonymous.item)
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 1
    assert post.item.get('anonymousLikeCount', 0) == 2

    # checking junk like status
    with pytest.raises(Exception, match='junkjunk'):
        post_manager.on_like_add('unused', {**like_onymous.item, 'likeStatus': 'junkjunk'})
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 1
    assert post.item.get('anonymousLikeCount', 0) == 2


@pytest.mark.parametrize(
    'like_onymous, like_anonymous',
    [
        pytest.lazy_fixture(['like_onymous_new', 'like_anonymous_new']),
        pytest.lazy_fixture(['like_onymous_old', 'like_anonymous_old']),
    ],
)
def test_on_like_delete(post_manager, post, like_onymous, like_anonymous, caplog):
    # configure and check starting state
    post_manager.dynamo.increment_onymous_like_count(post.id)
    post_manager.dynamo.increment_anonymous_like_count(post.id)
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 1
    assert post.item.get('anonymousLikeCount', 0) == 1

    # trigger, check state
    post_manager.on_like_delete('unused', like_onymous.item)
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 0
    assert post.item.get('anonymousLikeCount', 0) == 1

    # trigger, check state
    post_manager.on_like_delete('unused', like_anonymous.item)
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 0
    assert post.item.get('anonymousLikeCount', 0) == 0

    # trigger, check fails softly
    with caplog.at_level(logging.WARNING):
        post_manager.on_like_delete('unused', like_onymous.item)
    assert len(caplog.records) == 1
    assert 'Failed to decrement' in caplog.records[0].msg
    assert 'onymousLikeCount' in caplog.records[0].msg
    assert post.id in caplog.records[0].msg
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 0
    assert post.item.get('anonymousLikeCount', 0) == 0

    # checking junk like status
    with pytest.raises(Exception, match='junkjunk'):
        post_manager.on_like_delete('unused', {**like_onymous.item, 'likeStatus': 'junkjunk'})
    post.refresh_item()
    assert post.item.get('onymousLikeCount', 0) == 0
    assert post.item.get('anonymousLikeCount', 0) == 0


def test_on_view_add_view_by_post_owner_clears_unviewed_comments(post_manager, post):
    # add some state to clear, verify
    post_manager.dynamo.set_last_unviewed_comment_at(post.item, pendulum.now('utc'))
    post_manager.dynamo.increment_comment_count(post.id, viewed=False)
    post.refresh_item()
    assert 'gsiA3PartitionKey' in post.item
    assert post.item.get('commentsUnviewedCount', 0) == 1

    # react to a view by a non-post owner, verify doesn't change state
    post_manager.on_view_add(post.id, {'sortKey': f'view/{uuid4()}'})
    post.refresh_item()
    assert 'gsiA3PartitionKey' in post.item
    assert post.item.get('commentsUnviewedCount', 0) == 1

    # react to a view by post owner, verify state reset
    post_manager.on_view_add(post.id, {'sortKey': f'view/{post.user_id}'})
    post.refresh_item()
    assert 'gsiA3PartitionKey' not in post.item
    assert post.item.get('commentsUnviewedCount', 0) == 0


def test_on_view_add_view_by_post_owner_clears_cards(post_manager, post):
    # react to a view by a non-post owner, verify no calls
    with patch.object(post_manager, 'card_manager') as card_manager_mock:
        post_manager.on_view_add(post.id, {'sortKey': f'view/{uuid4()}'})
    assert len(card_manager_mock.mock_calls) == 0

    # react to a view by post owner, verify calls
    with patch.object(post_manager, 'card_manager') as card_manager_mock:
        post_manager.on_view_add(post.id, {'sortKey': f'view/{post.user_id}'})
    assert len(card_manager_mock.mock_calls) == 3
    card_spec0 = card_manager_mock.mock_calls[0].args[0]
    card_spec1 = card_manager_mock.mock_calls[1].args[0]
    card_spec2 = card_manager_mock.mock_calls[2].args[0]
    assert card_spec0.card_id == CommentCardSpec(post.user_id, post.id).card_id
    assert card_spec1.card_id == PostLikesCardSpec(post.user_id, post.id).card_id
    assert card_spec2.card_id == PostViewsCardSpec(post.user_id, post.id).card_id
    assert card_manager_mock.mock_calls == [
        call.remove_card_by_spec_if_exists(card_spec0),
        call.remove_card_by_spec_if_exists(card_spec1),
        call.remove_card_by_spec_if_exists(card_spec2),
    ]


def test_on_delete_removes_cards(post_manager, post):
    with patch.object(post_manager, 'card_manager') as card_manager_mock:
        post_manager.on_delete(post.id, post.item)
    assert len(card_manager_mock.mock_calls) == 3
    card_spec0 = card_manager_mock.mock_calls[0].args[0]
    card_spec1 = card_manager_mock.mock_calls[1].args[0]
    card_spec2 = card_manager_mock.mock_calls[2].args[0]
    assert card_spec0.card_id == CommentCardSpec(post.user_id, post.id).card_id
    assert card_spec1.card_id == PostLikesCardSpec(post.user_id, post.id).card_id
    assert card_spec2.card_id == PostViewsCardSpec(post.user_id, post.id).card_id
    assert card_manager_mock.mock_calls == [
        call.remove_card_by_spec_if_exists(card_spec0),
        call.remove_card_by_spec_if_exists(card_spec1),
        call.remove_card_by_spec_if_exists(card_spec2),
    ]