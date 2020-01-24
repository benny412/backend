/* eslint-env jest */

const path = require('path')
const uuidv4 = require('uuid/v4')

const cognito = require('../../utils/cognito.js')
const misc = require('../../utils/misc.js')
const schema = require('../../utils/schema.js')

const contentType = 'image/jpeg'
const filePath = path.join(__dirname, '..', '..', 'fixtures', 'grant.jpg')

const loginCache = new cognito.AppSyncLoginCache()

beforeAll(async () => {
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
})

beforeEach(async () => await loginCache.clean())
afterAll(async () => await loginCache.clean())


test('Cant request over 100 of any of the like lists', async () => {
  // we add a post
  const [ourClient] = await loginCache.getCleanLogin()
  const postId = uuidv4()
  let resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId, text: 'lore ipsum'}})
  expect(resp['errors']).toBeUndefined()

  // verify these queries go through with just under the limit
  resp = await ourClient.query({query: schema.getPost, variables: {postId, onymouslyLikedByLimit: 100}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.query({query: schema.self, variables: {onymouslyLikedPostsLimit: 100}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.query({query: schema.self, variables: {anonymouslyLikedPostsLimit: 100}})
  expect(resp['errors']).toBeUndefined()

  // verify they fail when asking for just over the limit
  resp = await ourClient.query({query: schema.getPost, variables: {postId, onymouslyLikedByLimit: 101}})
  expect(resp['errors'].length).toBeTruthy()
  resp = await ourClient.query({query: schema.self, variables: {onymouslyLikedPostsLimit: 101}})
  expect(resp['errors'].length).toBeTruthy()
  resp = await ourClient.query({query: schema.self, variables: {anonymouslyLikedPostsLimit: 101}})
  expect(resp['errors'].length).toBeTruthy()
})


test('Order of users that have onymously liked a post', async () => {
  // us and two other private users
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()
  const [other1Client, other1UserId] = await loginCache.getCleanLogin()
  const [other2Client, other2UserId] = await loginCache.getCleanLogin()

  // we add a post
  const postId = uuidv4()
  let resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId, text: 'lore ipsum'}})
  expect(resp['errors']).toBeUndefined()

  // all three of us onymously like it
  resp = await other2Client.mutate({mutation: schema.onymouslyLikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  resp = await other1Client.mutate({mutation: schema.onymouslyLikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()

  // check details on the post
  resp = await ourClient.query({query: schema.getPost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  let post = resp['data']['getPost']
  expect(post['likeStatus']).toBe('ONYMOUSLY_LIKED')
  expect(post['onymousLikeCount']).toBe(3)
  expect(post['onymouslyLikedBy']['items']).toHaveLength(3)
  expect(post['onymouslyLikedBy']['items'][0]['userId']).toBe(other2UserId)
  expect(post['onymouslyLikedBy']['items'][1]['userId']).toBe(ourUserId)
  expect(post['onymouslyLikedBy']['items'][2]['userId']).toBe(other1UserId)

  // check order of list of users that onymously liked the post
  resp = await ourClient.query({query: schema.getPost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getPost']['onymouslyLikedBy']['items']).toHaveLength(3)
  expect(resp['data']['getPost']['onymouslyLikedBy']['items'][0]['userId']).toBe(other2UserId)
  expect(resp['data']['getPost']['onymouslyLikedBy']['items'][1]['userId']).toBe(ourUserId)
  expect(resp['data']['getPost']['onymouslyLikedBy']['items'][2]['userId']).toBe(other1UserId)

  // we dislike it
  resp = await ourClient.mutate({mutation: schema.dislikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  post = resp['data']['dislikePost']
  expect(post['likeStatus']).toBe('NOT_LIKED')
  expect(post['onymousLikeCount']).toBe(2)
  expect(post['onymouslyLikedBy']['items']).toHaveLength(2)
  expect(post['onymouslyLikedBy']['items'][0]['userId']).toBe(other2UserId)
  expect(post['onymouslyLikedBy']['items'][1]['userId']).toBe(other1UserId)

  // check order of list of users that onymously liked the post
  resp = await ourClient.query({query: schema.getPost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['getPost']['onymouslyLikedBy']['items']).toHaveLength(2)
  expect(resp['data']['getPost']['onymouslyLikedBy']['items'][0]['userId']).toBe(other2UserId)
  expect(resp['data']['getPost']['onymouslyLikedBy']['items'][1]['userId']).toBe(other1UserId)

  // other2 dislikes it
  resp = await other2Client.mutate({mutation: schema.dislikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  post = resp['data']['dislikePost']
  expect(post['likeStatus']).toBe('NOT_LIKED')
  expect(post['onymousLikeCount']).toBe(1)
  expect(post['onymouslyLikedBy']['items']).toHaveLength(1)
  expect(post['onymouslyLikedBy']['items'][0]['userId']).toBe(other1UserId)

  // double check the post
  resp = await ourClient.query({query: schema.getPost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  post = resp['data']['getPost']
  expect(post['likeStatus']).toBe('NOT_LIKED')
  expect(post['onymousLikeCount']).toBe(1)
  expect(post['onymouslyLikedBy']['items']).toHaveLength(1)
  expect(post['onymouslyLikedBy']['items'][0]['userId']).toBe(other1UserId)
})


test('Order of onymously liked posts', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()

  // we add two posts
  const [postId1, postId2] = [uuidv4(), uuidv4()]
  let resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId: postId1, text: 'lore'}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId: postId2, text: 'lore ipsum'}})
  expect(resp['errors']).toBeUndefined()

  // we onymously like both in reverse order
  resp = await ourClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId: postId2}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId: postId1}})
  expect(resp['errors']).toBeUndefined()

  // check list order
  resp = await ourClient.query({query: schema.user, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['onymouslyLikedPosts']['items']).toHaveLength(2)
  expect(resp['data']['user']['onymouslyLikedPosts']['items'][0]['postId']).toBe(postId1)
  expect(resp['data']['user']['onymouslyLikedPosts']['items'][1]['postId']).toBe(postId2)

  // dislike the older one and re-like it
  resp = await ourClient.mutate({mutation: schema.dislikePost, variables: {postId: postId2}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId: postId2}})
  expect(resp['errors']).toBeUndefined()

  // check list order has reversed
  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['onymouslyLikedPosts']['items']).toHaveLength(2)
  expect(resp['data']['self']['onymouslyLikedPosts']['items'][0]['postId']).toBe(postId2)
  expect(resp['data']['self']['onymouslyLikedPosts']['items'][1]['postId']).toBe(postId1)
})


test('Order of anonymously liked posts', async () => {
  const [ourClient, ourUserId] = await loginCache.getCleanLogin()

  // we add two posts
  const [postId1, postId2] = [uuidv4(), uuidv4()]
  let resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId: postId1, text: 'lore'}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.mutate({mutation: schema.addTextOnlyPost, variables: {postId: postId2, text: 'lore ipsum'}})
  expect(resp['errors']).toBeUndefined()

  // we anonymously like both in reverse order
  resp = await ourClient.mutate({mutation: schema.anonymouslyLikePost, variables: {postId: postId2}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.mutate({mutation: schema.anonymouslyLikePost, variables: {postId: postId1}})
  expect(resp['errors']).toBeUndefined()

  // check list order
  resp = await ourClient.query({query: schema.user, variables: {userId: ourUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['anonymouslyLikedPosts']['items']).toHaveLength(2)
  expect(resp['data']['user']['anonymouslyLikedPosts']['items'][0]['postId']).toBe(postId1)
  expect(resp['data']['user']['anonymouslyLikedPosts']['items'][1]['postId']).toBe(postId2)

  // dislike the older one and re-like it
  resp = await ourClient.mutate({mutation: schema.dislikePost, variables: {postId: postId2}})
  expect(resp['errors']).toBeUndefined()
  resp = await ourClient.mutate({mutation: schema.anonymouslyLikePost, variables: {postId: postId2}})
  expect(resp['errors']).toBeUndefined()

  // check list order has reversed
  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['anonymouslyLikedPosts']['items']).toHaveLength(2)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][0]['postId']).toBe(postId2)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][1]['postId']).toBe(postId1)
})


test('Media objects show up correctly in lists of liked posts', async () => {
  const [ourClient] = await loginCache.getCleanLogin()
  const [theirClient, theirUserId] = await loginCache.getCleanLogin()

  // add a media post
  // add a pending post object with two images
  const postId = uuidv4()
  const mediaId = uuidv4()
  let resp = await ourClient.mutate({
    mutation: schema.addOneMediaPost,
    variables: {postId, mediaId, mediaType: 'IMAGE'},
  })
  expect(resp['errors']).toBeUndefined()
  const uploadUrl = resp['data']['addPost']['mediaObjects'][0]['uploadUrl']
  await misc.uploadMedia(filePath, contentType, uploadUrl)
  await misc.sleep(2000)

  // we anonymously like the post, they onymously like it
  resp = await ourClient.mutate({mutation: schema.anonymouslyLikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()
  resp = await theirClient.mutate({mutation: schema.onymouslyLikePost, variables: {postId}})
  expect(resp['errors']).toBeUndefined()

  // we check our list of posts we anonymously liked
  resp = await ourClient.query({query: schema.self})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['self']['anonymouslyLikedPosts']['items']).toHaveLength(1)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][0]['postId']).toBe(postId)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][0]['mediaObjects']).toHaveLength(1)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][0]['mediaObjects'][0]['mediaId']).toBe(mediaId)
  expect(resp['data']['self']['anonymouslyLikedPosts']['items'][0]['mediaObjects'][0]['url']).toBeTruthy()

  // we check their list of posts they onymously liked
  resp = await ourClient.query({query: schema.user, variables: {userId: theirUserId}})
  expect(resp['errors']).toBeUndefined()
  expect(resp['data']['user']['onymouslyLikedPosts']['items']).toHaveLength(1)
  expect(resp['data']['user']['onymouslyLikedPosts']['items'][0]['postId']).toBe(postId)
  expect(resp['data']['user']['onymouslyLikedPosts']['items'][0]['mediaObjects']).toHaveLength(1)
  expect(resp['data']['user']['onymouslyLikedPosts']['items'][0]['mediaObjects'][0]['mediaId']).toBe(mediaId)
  expect(resp['data']['user']['onymouslyLikedPosts']['items'][0]['mediaObjects'][0]['url']).toBeTruthy()
})