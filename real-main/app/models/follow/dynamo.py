from datetime import datetime
from functools import reduce
import logging

from boto3.dynamodb.conditions import Key

from app.lib import datetime as real_datetime

logger = logging.getLogger()


class FollowDynamo:

    def __init__(self, dynamo_client):
        self.client = dynamo_client

    def get_following(self, follower_user_id, followed_user_id):
        return self.client.get_item({
            'partitionKey': f'following/{follower_user_id}/{followed_user_id}',
            'sortKey': '-',
        })

    def transact_add_following(self, follower_user_id, followed_user_id, follow_status):
        followed_at = real_datetime.serialize(datetime.utcnow())
        transact = {
            'Put': {
                'Item': {
                    'schemaVersion': {'N': '1'},
                    'partitionKey': {'S': f'following/{follower_user_id}/{followed_user_id}'},
                    'sortKey': {'S': '-'},
                    'gsiA1PartitionKey': {'S': f'follower/{follower_user_id}'},
                    'gsiA1SortKey': {'S': f'{follow_status}/{followed_at}'},
                    'gsiA2PartitionKey': {'S': f'followed/{followed_user_id}'},
                    'gsiA2SortKey': {'S': f'{follow_status}/{followed_at}'},
                    'followedAt': {'S': followed_at},
                    'followStatus': {'S': follow_status},
                    'followerUserId': {'S': follower_user_id},
                    'followedUserId': {'S': followed_user_id},
                },
                'ConditionExpression': 'attribute_not_exists(partitionKey)',  # only creates
            },
        }
        return transact

    def transact_update_following_status(self, follow_item, follow_status):
        set_exps = [
            'followStatus = :status',
            'gsiA1SortKey = :sk',
            'gsiA2SortKey = :sk',
        ]
        exp_values = {
            ':status': {'S': follow_status},
            ':sk': {'S': f'{follow_status}/{follow_item["followedAt"]}'},
        }

        transact = {
            'Update': {
                'Key': {
                    'partitionKey': {'S': follow_item['partitionKey']},
                    'sortKey': {'S': follow_item['sortKey']},
                },
                'UpdateExpression': 'SET ' + ', '.join(set_exps),
                'ExpressionAttributeValues': exp_values,
                'ConditionExpression': 'attribute_exists(partitionKey)',  # only updates
            },
        }
        return transact

    def transact_delete_following(self, follow_item):
        transact = {
            'Delete': {
                'Key': {
                    'partitionKey': {'S': follow_item['partitionKey']},
                    'sortKey': {'S': follow_item['sortKey']},
                },
                'ConditionExpression': 'attribute_exists(partitionKey)',  # fail loudly if doesn't exist
            },
        }
        return transact

    def generate_followed_items(self, user_id, follow_status=None, limit=None, next_token=None):
        "Generate items that represent a followed of the given user (that the given user is the follower)"
        key_conditions = [Key('gsiA1PartitionKey').eq(f'follower/{user_id}')]
        if follow_status is not None:
            key_conditions.append(Key('gsiA1SortKey').begins_with(follow_status + '/'))
        query_kwargs = {
            'KeyConditionExpression': reduce(lambda a, b: a & b, key_conditions),
            'IndexName': 'GSI-A1',
        }
        return self.client.generate_all_query(query_kwargs)

    def generate_follower_items(self, user_id, follow_status=None, limit=None, next_token=None):
        "Generate items that represent a follower of the given user (that the given user is the followed)"
        key_conditions = [Key('gsiA2PartitionKey').eq(f'followed/{user_id}')]
        if follow_status is not None:
            key_conditions.append(Key('gsiA2SortKey').begins_with(follow_status + '/'))
        query_kwargs = {
            'KeyConditionExpression': reduce(lambda a, b: a & b, key_conditions),
            'IndexName': 'GSI-A2',
        }
        return self.client.generate_all_query(query_kwargs)