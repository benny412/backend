#!/usr/bin/env node

/* eslint no-unused-vars: 0 */

const AWS = require('aws-sdk')
const AWSAppSyncClient = require('aws-appsync').default
const dotenv = require('dotenv')
const fs = require('fs')
const gql = require('graphql-tag')
const util = require('util')
const uuidv4 = require('uuid/v4')
require('isomorphic-fetch')

const { mutations, queries } = require('../schema')

dotenv.config()

const awsRegion = process.env.AWS_REGION
if (awsRegion === undefined) throw new Error('Env var AWS_REGION must be defined')

const appsyncApiUrl = process.env.APPSYNC_API_URL
if (appsyncApiUrl === undefined) throw new Error('Env var APPSYNC_API_URL must be defined')

if (process.argv.length != 3) {
  console.log('Usage: run.gql.js <tokens/credential file generated by sign-user-in.js>')
  process.exit(1)
}

const tokensCreds = JSON.parse(fs.readFileSync(process.argv[2]))
const cognitoAccessToken = tokensCreds['tokens']['AccessToken']
const authProvider = tokensCreds['authProvider']

const awsCredentials = new AWS.Credentials(
  tokensCreds['credentials']['AccessKeyId'],
  tokensCreds['credentials']['SecretKey'],
  tokensCreds['credentials']['SessionToken'],
)

const appsyncClient = new AWSAppSyncClient({
  url: appsyncApiUrl,
  region: awsRegion,
  auth: {
    type: 'AWS_IAM',
    credentials: awsCredentials,
  },
  disableOffline: true,
}, {
  defaultOptions: {
    query: {
      fetchPolicy: 'network-only',
      errorPolicy: 'all',
    },
  },
})

const startChangeUserEmail = gql`
  mutation StartChangeUserEmail ($email: AWSEmail!) {
    startChangeUserEmail (email: $email) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const finishChangeUserEmail = gql`
  mutation FinishChangeUserEmail ($cognitoAccessToken: String!, $verificationCode: String!) {
    finishChangeUserEmail (cognitoAccessToken: $cognitoAccessToken, verificationCode: $verificationCode) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const startChangeUserPhoneNumber = gql`
  mutation StartChangeUserPhoneNumber ($phoneNumber: AWSPhone!) {
    startChangeUserPhoneNumber (phoneNumber: $phoneNumber) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const finishChangeUserPhoneNumber = gql`
  mutation FinishChangeUserPhoneNumber ($cognitoAccessToken: String!, $verificationCode: String!) {
    finishChangeUserPhoneNumber (cognitoAccessToken: $cognitoAccessToken, verificationCode: $verificationCode) {
      userId
      username
      email
      phoneNumber
    }
  }
`

const setUserDetails = gql`
  mutation SetUserDetails {
    setUserDetails (fullName: "Miss. Purple", bio: "millions of peaches") {
      userId
      username
      fullName
      bio
      email
      phoneNumber
    }
  }
`

const lambdaClientError = gql`
  mutation LambdaClientError {
    lambdaClientError (arg1: "test-arg1", arg2: "test-arg2")
  }
`

const lambdaServerError = gql`
  mutation LambdaServerError {
    lambdaServerError (arg1: "test-arg1", arg2: "test-arg2")
  }
`

const dynamoServerError = gql`
  mutation DynamoServerError {
    dynamoServerError (arg1: "test-arg1", arg2: "test-arg2")
  }
`

const main = async () => {
  const resp = await appsyncClient.query({query: queries.self})
  /*
  const resp = await appsyncClient.mutate({
    mutation: mutations.createCognitoOnlyUser,
    variables: {username: uuidv4().substring(24), fullName: 'my full name'},
  })
  const resp = await appsyncClient.mutate({mutation: mutations.resetUser})
  const resp = await appsyncClient.mutate({
    mutation: startChangeUserEmail,
    variables: {email: ''},
  })
  const resp = await appsyncClient.mutate({
    mutation: finishChangeUserEmail,
    variables: {cognitoAccessToken, verificationCode: ''},
  })
  const resp = await appsyncClient.mutate({
    mutation: startChangeUserPhoneNumber,
    variables: {phoneNumber: ''},
  })
  const resp = await appsyncClient.mutate({
    mutation: finishChangeUserPhoneNumber,
    variables: {cognitoAccessToken, verificationCode: ''},
  })
  */
  // log object to full depth https://stackoverflow.com/a/10729284
  console.log(JSON.stringify(resp, null, 2))
}

main()
