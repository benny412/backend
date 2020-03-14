import logging

from . import enums, exceptions

logger = logging.getLogger()


class ChatMessage:

    enums = enums
    exceptions = exceptions

    def __init__(self, item, chat_message_dynamo):
        self.dynamo = chat_message_dynamo
        self.item = item
        # immutables
        self.id = item['messageId']
        self.chat_id = self.item['chatId']
        self.user_id = self.item['userId']

    def refresh_item(self, strongly_consistent=False):
        self.item = self.dynamo.get_chat_message(self.id, strongly_consistent=strongly_consistent)
        return self

    def serialize(self, caller_user_id):
        resp = self.item.copy()
        if resp['userId'] == caller_user_id:  # author of the message
            resp['viewedStatus'] = enums.ViewedStatus.VIEWED
        elif self.dynamo.get_chat_view_message(self.id, caller_user_id):
            resp['viewedStatus'] = enums.ViewedStatus.VIEWED
        else:
            resp['viewedStatus'] = enums.ViewedStatus.NOT_VIEWED
        return resp
