# -*- coding: utf-8 -*-

import json
import pprint
import random
import string
import logging
import requests
from odoo import fields, models

_logger = logging.getLogger(__name__)


class PosPaymentMethod(models.Model):
    _inherit = 'pos.payment.method'

    def _get_payment_terminal_selection(self):
        return super(PosPaymentMethod, self)._get_payment_terminal_selection() + [('cardknox', 'Cardknox')]

    cardknox_xkey = fields.Char(string="xKey")
    cardknox_xsoftware_name = fields.Char(string="xSoftware Name", copy=False)
    cardknox_xversion = fields.Char(string="xVersion", copy=False)
    cardknox_xsoftware_version = fields.Char(string="xSoftware Version", copy=False, default=1.0)

    def _get_cardknox_endpoints(self):
        return 'https://x1.cardknox.com/gatewayjson'

    def proxy_cardknox_request(self, data, operation=False):
        ''' Necessary because Cardknox's endpoints don't have CORS enabled '''

        if not operation:
            operation = 'terminal_request'

        return self._proxy_cardknox_request_direct(data, operation)

    def _proxy_cardknox_request_direct(self, data, operation):
        self.ensure_one()
        TIMEOUT = 10

        _logger.info('request to cardknox\n%s', pprint.pformat(data))

        data.update({
            'xKey': self.cardknox_xkey,
            'xCardNum': '4444333322221111',
            # 'xCardNum': '567890123456567890',
            'xSoftwareName': self.cardknox_xsoftware_name,
            'xCommand': 'cc:sale',
            'xSoftwareVersion': '1.0',
            'xVersion': self.cardknox_xversion,
            'xExp': '1030',
        })

        return self._post_cardknox_data(data)

    def _post_cardknox_data(self, json_data=None):
        endpoint_url = self._get_cardknox_endpoints()
        req = requests.post(endpoint_url, json=json_data)

        # Authentication error doesn't return JSON
        if req.status_code == 401:
            return {
                'error': {
                    'status_code': req.status_code,
                    'message': req.text
                }
            }

        if req.text == 'ok':
            return True

        return req.json()

    def get_latest_cardknox_status(self, pos_config_name, ref_num):
        self.ensure_one()

        # Poll the status of the terminal if there's no new
        # notification we received. This is done, so we can quickly
        # notify the user if the terminal is no longer reachable due
        # to connectivity issues.
        self._post_cardknox_data(self.cardknox_diagnosis_request_data(ref_num, pos_config_name))

        latest_response = self.sudo().adyen_latest_response
        latest_response = json.loads(latest_response) if latest_response else False

        return {
            'latest_response': latest_response,
            'last_received_diagnosis_id': self.sudo().adyen_latest_diagnosis,
        }

    def cardknox_diagnosis_request_data(self, ref_num, pos_config_name):
        service_id = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
        return {
            "xKey": self.cardknox_xkey,
            "xVersion": self.cardknox_xversion,
            "xSoftwareName": self.cardknox_xsoftware_name,
            "xSoftwareVersion": self.cardknox_xsoftware_version,
            "xCommand": "cc:sale",
            "xCustom01": "Register01",
            "xRefNum": ref_num,
        }

