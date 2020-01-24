import json
import logging
import os

import boto3
import requests
from requests_aws4auth import AWS4Auth

logger = logging.getLogger()

REGION = os.environ.get('REGION')
ES_SEARCH_DOMAIN = os.environ.get('ES_SEARCH_DOMAIN')


class ESSearchClient:

    service = 'es'
    headers = {'Content-Type': 'application/json'}
    keys = [
        'phoneNumber',
        'privacyStatus',
        'userId',
        'email',
        'username',
        'fullName',
        'bio',
    ]

    def __init__(self, region=REGION, domain=ES_SEARCH_DOMAIN):
        assert region, '`region` is required'
        assert domain, '`domain` is required'
        self.region = region
        self.domain = domain

    @property
    def awsauth(self):
        if not hasattr(self, '_awsauth'):
            credentials = boto3.Session().get_credentials()
            self._awsauth = AWS4Auth(
                credentials.access_key, credentials.secret_key, self.region, self.service,
                session_token=credentials.token,
            )
        return self._awsauth

    def build_user_url(self, user_id):
        return f'https://{self.domain}/users/_doc/{user_id}'

    def build_user_doc(self, dynamodb_user_item):
        return {k: next(iter(dynamodb_user_item[k].values())) for k in self.keys if k in dynamodb_user_item}

    def add_user(self, dynamodb_new_user_item):
        doc = self.build_user_doc(dynamodb_new_user_item)
        url = self.build_user_url(doc['userId'])
        logging.info(f'ElasticSearch: Adding user to index at `{url}` ' + json.dumps(doc))
        resp = requests.put(url, auth=self.awsauth, json=doc, headers=self.headers)
        if resp.status_code != 201:
            logging.warning(
                f'ElasticSearch: Recieved non-201 response of {resp.status_code} when adding user'
            )

    def update_user(self, dynamodb_old_user_item, dynamodb_new_user_item):
        assert dynamodb_old_user_item['userId'] == dynamodb_new_user_item['userId']
        old_doc = self.build_user_doc(dynamodb_old_user_item)
        new_doc = self.build_user_doc(dynamodb_new_user_item)
        if old_doc == new_doc:
            # no changes that effect elasticsearch
            return
        url = self.build_user_url(old_doc['userId'])
        logging.info(f'ElasticSearch: Updating user in index at `{url}` ' + json.dumps(new_doc))
        resp = requests.put(url, auth=self.awsauth, json=new_doc, headers=self.headers)
        if resp.status_code != 200:
            logging.warning(f'ElasticSearch: Recieved non-200 response of {resp.status_code} when updating user')

    def delete_user(self, dynamodb_old_user_item):
        old_doc = self.build_user_doc(dynamodb_old_user_item)
        url = self.build_user_url(old_doc['userId'])
        logging.info(f'ElasticSearch: Deleting user from index at `{url}`')
        resp = requests.delete(url, auth=self.awsauth)
        if resp.status_code != 200:
            logging.warning(f'ElasticSearch: Recieved non-200 response of {resp.status_code} when deleting user')