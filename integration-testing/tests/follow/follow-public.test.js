/* eslint-env jest */

const uuidv4 = require('uuid/v4')

const cognito = require('../../utils/cognito.js')
const schema = require('../../utils/schema.js')

const loginCache = new cognito.AppSyncLoginCache()

beforeAll(async () => {
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
})

beforeEach(async () => await loginCache.clean())
afterAll(async () => await loginCache.clean())


test('Follow & unfollow a public user', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()
  const [theirClient, theirUserId] = await loginCache.getCleanLogin()

  // check we start in a NOT_FOLLOWING state
  let resp = await ourClient.query({query: schema.user, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['followedStatus']).toBe('NOT_FOLLOWING')
  resp = await theirClient.query({query: schema.user, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['followerStatus']).toBe('NOT_FOLLOWING')

  // we follow them, goes through immediately
  resp = await ourClient.mutate({mutation: schema.followUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['followUser']['followedStatus']).toBe('FOLLOWING')

  // check we have moved to a FOLLOWING state
  resp = await ourClient.query({query: schema.user, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['followedStatus']).toBe('FOLLOWING')
  resp = await theirClient.query({query: schema.user, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['followerStatus']).toBe('FOLLOWING')

  // we unfollow them, goes through immediately
  resp = await ourClient.mutate({mutation: schema.unfollowUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['unfollowUser']['followedStatus']).toBe('NOT_FOLLOWING')

  // check we have moved to a NOT_FOLLOWING state
  resp = await ourClient.query({query: schema.user, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['followedStatus']).toBe('NOT_FOLLOWING')
  resp = await theirClient.query({query: schema.user, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['followerStatus']).toBe('NOT_FOLLOWING')
})


test('Try to double follow a user', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()
  const [theirClient, theirUserId] = await loginCache.getCleanLogin()

  // we follow them, goes through immediately
  let resp = await ourClient.mutate({mutation: schema.followUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['followUser']['followedStatus']).toBe('FOLLOWING')

  // we cannot follow them again
  await expect(ourClient.mutate({mutation: schema.followUser, variables: {userId: theirUserId}})).rejects.toThrow()

  // verify we're still in following them
  resp = await theirClient.query({query: schema.ourFollowerUsers})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['followerUsers']['items']).toHaveLength(1)
  expect(resp['data']['self']['followerUsers']['items'][0]['userId']).toBe(ourUserId)

  // unfollow ther user
  resp = await ourClient.mutate({mutation: schema.unfollowUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['unfollowUser']['followedStatus']).toBe('NOT_FOLLOWING')

  // change the other user to private
  resp = await theirClient.mutate({mutation: schema.setUserPrivacyStatus, variables: {privacyStatus: 'PRIVATE'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['setUserDetails']['privacyStatus']).toBe('PRIVATE')

  // we follow them, goes to REQUESTED
  resp = await ourClient.mutate({mutation: schema.followUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['followUser']['followedStatus']).toBe('REQUESTED')

  // we cannot follow them again
  await expect(ourClient.mutate({mutation: schema.followUser, variables: {userId: theirUserId}})).rejects.toThrow()

  // verify we're still in REQUESTED state
  resp = await theirClient.query({query: schema.ourFollowerUsers, variables: {followStatus: 'REQUESTED'}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['followerUsers']['items']).toHaveLength(1)
  expect(resp['data']['self']['followerUsers']['items'][0]['userId']).toBe(ourUserId)
})


test('Try to unfollow a user we are not following', async () => {
  const [ourClient] = await loginCache.getCleanLogin()
  const [, theirUserId] = await loginCache.getCleanLogin()

  // try to unfollow them
  await expect(ourClient.mutate({mutation: schema.unfollowUser, variables: {userId: theirUserId}})).rejects.toThrow()
})


test('When we stop following a public user, any likes of ours on their posts are unchanged', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()
  const [theirClient, theirUserId] = await loginCache.getCleanLogin()

  // we follow them
  let resp = await ourClient.mutate({mutation: schema.followUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['followUser']['followedStatus']).toBe('FOLLOWING')

  // they add two posts
  const [postId1, postId2] = [uuidv4(), uuidv4()]
  resp = await theirClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId: postId1, text: 'lore'}})
  expect(resp['errors']).toBeUndefined()
  resp = await theirClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId: postId2, text: 'lore'}})
  expect(resp['errors']).toBeUndefined()

  // we like the first post onymously
  resp = await ourClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId: postId1}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['onymouslyLikePost']['postId']).toBe(postId1)
  expect(resp['data']['onymouslyLikePost']['likeStatus']).toBe('ONYMOUSLY_LIKED')

  // we like the second post anonymously
  resp = await ourClient.mutate({mutation: schema.anonymouslyLikePost, variables: {postId: postId2}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['anonymouslyLikePost']['postId']).toBe(postId2)
  expect(resp['data']['anonymouslyLikePost']['likeStatus']).toBe('ANONYMOUSLY_LIKED')

  // check those likes show up in the lists
  resp = await ourClient.query({query: schema.getPost, variables: {postId: postId1}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getPost']['onymouslyLikedBy']['items']).toHaveLength(1)
  expect(resp['data']['getPost']['onymouslyLikedBy']['items'][0]['userId']).toBe(ourUserId)

  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['onymouslyLikedPosts']['items']).toHaveLength(1)
  expect(resp['data']['self']['onymouslyLikedPosts']['items'][0]['postId']).toBe(postId1)

  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['anonymouslyLikedPosts']['items']).toHaveLength(1)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][0]['postId']).toBe(postId2)

  // we stop following the user
  resp = await ourClient.mutate({mutation: schema.unfollowUser, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['unfollowUser']['followedStatus']).toBe('NOT_FOLLOWING')

  // check nothing changed in those lists
  resp = await ourClient.query({query: schema.getPost, variables: {postId: postId1}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getPost']['onymouslyLikedBy']['items']).toHaveLength(1)
  expect(resp['data']['getPost']['onymouslyLikedBy']['items'][0]['userId']).toBe(ourUserId)

  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['onymouslyLikedPosts']['items']).toHaveLength(1)
  expect(resp['data']['self']['onymouslyLikedPosts']['items'][0]['postId']).toBe(postId1)

  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['anonymouslyLikedPosts']['items']).toHaveLength(1)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][0]['postId']).toBe(postId2)
})