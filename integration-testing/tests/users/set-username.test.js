/* eslint-env jest */

const cognito = require('../../utils/cognito.js')
const misc = require('../../utils/misc.js')
const schema = require('../../utils/schema.js')

const AuthFlow = cognito.AuthFlow

const loginCache = new cognito.AppSyncLoginCache()

beforeAll(async () => {
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
  loginCache.addCleanLogin(await cognito.getAppSyncLogin())
})

beforeEach(async () => await loginCache.clean())
afterAll(async () => await loginCache.clean())


test('setting invalid username fails', async () => {
  const [client] = await loginCache.getCleanLogin()
  const usernameTooShort = 'aa'
  const usernameTooLong = 'a'.repeat(31)
  const usernameBadChar = 'a!a'

  const mutation = schema.setUsername
  await expect(client.mutate({mutation, variables: {username: usernameTooShort}})).rejects.toThrow('ClientError')
  await expect(client.mutate({mutation, variables: {username: usernameTooLong}})).rejects.toThrow('ClientError')
  await expect(client.mutate({mutation, variables: {username: usernameBadChar}})).rejects.toThrow('ClientError')
})


test('changing username succeeds, then can use it to login in lowercase', async () => {
  const [client, , password] = await loginCache.getCleanLogin()
  const username = 'TESTERYESnoMAYBEso' + misc.shortRandomString()
  await client.mutate({mutation: schema.setUsername, variables: {username}})

  // try to login as the user in cognito with that new username, lowered
  const AuthParameters = {USERNAME: username.toLowerCase(), PASSWORD: password}
  const resp = await cognito.userPoolClient.initiateAuth({AuthFlow, AuthParameters}).promise()
  expect(resp).toHaveProperty('AuthenticationResult.AccessToken')
  expect(resp).toHaveProperty('AuthenticationResult.ExpiresIn')
  expect(resp).toHaveProperty('AuthenticationResult.RefreshToken')
  expect(resp).toHaveProperty('AuthenticationResult.IdToken')
})


test('collision on changing username fails, login username is not changed', async () => {
  const [ourClient, , ourPassword] = await loginCache.getCleanLogin()
  const [theirClient, , theirPassword] = await loginCache.getCleanLogin()

  const ourUsername = 'TESTERgotSOMEcase' + misc.shortRandomString()
  await ourClient.mutate({mutation: schema.setUsername, variables: {username: ourUsername}})

  const theirUsername = 'TESTERYESnoMAYBEso' + misc.shortRandomString()
  await theirClient.mutate({mutation: schema.setUsername, variables: {username: theirUsername}})

  // try and fail setting user1's username to user2's
  await expect(ourClient.mutate({
    mutation: schema.setUsername,
    variables: {username: theirUsername},
  })).rejects.toThrow('ClientError')

  // verify user1 can still login with their original username
  let AuthParameters = {USERNAME: ourUsername.toLowerCase(), PASSWORD: ourPassword}
  let resp = await cognito.userPoolClient.initiateAuth({AuthFlow, AuthParameters}).promise()
  expect(resp).toHaveProperty('AuthenticationResult.AccessToken')
  expect(resp).toHaveProperty('AuthenticationResult.ExpiresIn')
  expect(resp).toHaveProperty('AuthenticationResult.RefreshToken')
  expect(resp).toHaveProperty('AuthenticationResult.IdToken')

  // verify user2 can still login with their original username
  AuthParameters = {USERNAME: theirUsername.toLowerCase(), PASSWORD: theirPassword}
  resp = await cognito.userPoolClient.initiateAuth({AuthFlow, AuthParameters}).promise()
  expect(resp).toHaveProperty('AuthenticationResult.AccessToken')
  expect(resp).toHaveProperty('AuthenticationResult.ExpiresIn')
  expect(resp).toHaveProperty('AuthenticationResult.RefreshToken')
  expect(resp).toHaveProperty('AuthenticationResult.IdToken')
})
