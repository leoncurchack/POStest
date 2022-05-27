odoo.define('pos_cardknox_integration.payment', function (require) {
    "use strict";

    var rpc = require('web.rpc');
    var core = require('web.core');
    var PaymentInterface = require('point_of_sale.PaymentInterface');
    const { Gui } = require('point_of_sale.Gui');

    var _t = core._t;

    var PaymentCardknox = PaymentInterface.extend({
        send_payment_request: function (cid) {
            this._super.apply(this, arguments);
            this._reset_state();
            return this._cardknox_pay(cid);
        },

        send_payment_cancel: function (order, cid) {
            this._super.apply(this, arguments);
            // set only if we are polling
            this.was_cancelled = !!this.polling;
            return this._cardknox_cancel();
        },

        close: function () {
            this._super.apply(this, arguments);
        },

        _reset_state: function () {
            this.was_cancelled = false;
            this.last_diagnosis_service_id = false;
            this.remaining_polls = 4;
            clearTimeout(this.polling);
        },

        set_most_recent_service_id(id) {
            this.most_recent_service_id = id;
        },

        pending_cardknox_line() {
            return this.pos.get_order().paymentlines.find(
                paymentLine => paymentLine.payment_method.use_payment_terminal === 'cardknox' && (!paymentLine.is_done()));
        },

        _handle_odoo_connection_failure: function (data) {
            // handle timeout
            var line = this.pending_cardknox_line();
            if (line) {
                line.set_payment_status('retry');
            }
            this._show_error(_t('Could not connect to the Odoo server, please check your internet connection and try again.'));

            return Promise.reject(data); // prevent subsequent onFullFilled's from being called
        },

        _cardknox_pay: function (cid) {
            var self = this;
            var order = this.pos.get_order();

            if (order.selected_paymentline.amount < 0) {
                this._show_error(_t('Cannot process transactions with negative amount.'));
                return Promise.resolve();
            }

            if (order === this.poll_error_order) {
                delete this.poll_error_order;
                return self._cardknox_handle_response({});
            }

            var data = this._cardknox_pay_data();
            var line = order.paymentlines.find(paymentLine => paymentLine.cid === cid);
            line.setTerminalServiceId(this.most_recent_service_id);
            return this._call_cardknox(data).then(function (data) {
                return self._cardknox_handle_response(data);
            });
        },

        _call_cardknox: function (data, operation) {
            return rpc.query({
                model: 'pos.payment.method',
                method: 'proxy_cardknox_request',
                args: [[this.payment_method.id], data, operation],
            }, {
                // When a payment terminal is disconnected it takes Cardknox
                // a while to return an error (~6s). So wait 10 seconds
                // before concluding Odoo is unreachable.
                timeout: 10000,
                shadow: true,
            }).catch(this._handle_odoo_connection_failure.bind(this));
        },

        _cardknox_pay_data: function () {
            var order = this.pos.get_order();
            var config = this.pos.config;
            var line = order.selected_paymentline;
            if (order.attributes.client != null){
                var data = {
                    'xName': order.attributes.client.name,
                    'xOrderID': order.uid,
                    'xCommand': 'cc:sale',
                    'xCurrency': this.pos.currency.name,
                    'xAmount': line.amount,
                    'xExistingCustomer': 'TRUE',
                    'xAllowDuplicate': 'TRUE',
                };

                return data;
            }else{
                return this._show_error(_t("Please Choose Your Customer"));
            }
        },

        _cardknox_get_sale_id: function () {
            var config = this.pos.config;
            return _.str.sprintf('%s (ID: %s)', config.display_name, config.id);
        },

        _cardknox_common_message_header: function () {
            var config = this.pos.config;
            this.most_recent_service_id = Math.floor(Math.random() * Math.pow(2, 64)).toString(); // random ID to identify request/response pairs
            this.most_recent_service_id = this.most_recent_service_id.substring(0, 10); // max length is 10

            return {
                'SaleID': this._cardknox_get_sale_id(config),
                'ServiceID': this.most_recent_service_id,
                //  'POIID': this.payment_method.adyen_terminal_identifier
            };
        },

        _cardknox_handle_response: function (response) {
            var ref_num = response.xRefNum;
            var line = this.pending_cardknox_line();

            if (!response) {
                this._show_error(_t('Connection failed. Odoo needs an active connection to pay via Cardknox'));
                return Promise.resolve();
            }

            //  This is for Success alert
            if (response.xResult == 'A' && response.xStatus == 'Approved') {
                Gui.showPopup('ConfirmPopup', {
                    title: 'Payment Successful',
                    body: 'Your transaction is successfully completed.',
                });
                line.set_payment_status('done');
                return Promise.resolve(true);
            }

            if (response.xResult == 'E' && response.xStatus == 'Error') {
                //  this is from the Cardknox api response
                this._show_error(_t(response.xError));
                line.set_payment_status('force_done');
                return Promise.resolve();
            }

            /*response = response.SaleToPOIRequest;
            if (response && response.EventNotification && response.EventNotification.EventToNotify == 'Reject') {

                var msg = '';
                if (response.EventNotification) {
                    var params = new URLSearchParams(response.EventNotification.EventDetails);
                    msg = params.get('message');
                }

                this._show_error(_.str.sprintf(_t('An unexpected error occurred. Message from Cardknox: %s'), msg));
                if (line) {
                    line.set_payment_status('force_done');
                }

                return Promise.resolve();
            } else {
                line.set_payment_status('waitingCard');

                return this.start_get_status_polling(ref_num)
            }*/
        },

        _cardknox_cancel: function (ignore_error) {
            var self = this;
            var previous_service_id = this.most_recent_service_id;
            var header = _.extend(this._cardknox_common_message_header(), {
                'MessageCategory': 'Abort',
            });

            var data = {};

            return this._call_cardknox(data).then(function (data) {
                // Only valid response is a 200 OK HTTP response which is
                // represented by true.
                if (! ignore_error && data !== "ok") {
                    self._show_error(_t('Cancelling the payment failed. Please cancel it manually on the payment terminal.'));
                }
            });
        },

        _convert_receipt_info: function (output_text) {
            return output_text.reduce(function (acc, entry) {
                var params = new URLSearchParams(entry.Text);

                if (params.get('name') && !params.get('value')) {
                    return acc + _.str.sprintf('<br/>%s', params.get('name'));
                } else if (params.get('name') && params.get('value')) {
                    return acc + _.str.sprintf('<br/>%s: %s', params.get('name'), params.get('value'));
                }

                return acc;
            }, '');
        },

        _poll_for_response: function (response_ref, resolve, reject) {
            var self = this;
            if (this.was_cancelled) {
                resolve(false);
                return Promise.resolve();
            }

            return rpc.query({
                model: 'pos.payment.method',
                method: 'get_latest_cardknox_status',
                args: [[this.payment_method.id], this._cardknox_get_sale_id(), response_ref],
            }, {
                timeout: 5000,
                shadow: true,
            }).catch(function (data) {
                if (self.remaining_polls != 0) {
                    self.remaining_polls--;
                } else {
                    reject();
                    self.poll_error_order = self.pos.get_order();
                    return self._handle_odoo_connection_failure(data);
                }
                // This is to make sure that if 'data' is not an instance of Error (i.e. timeout error),
                // this promise don't resolve -- that is, it doesn't go to the 'then' clause.
                return Promise.reject(data);
            }).then(function (status) {
                var notification = status.latest_response;
                var last_diagnosis_service_id = status.last_received_diagnosis_id;
                var order = self.pos.get_order();
                var line = self.pending_cardknox_line();

                if (self.last_diagnosis_service_id != last_diagnosis_service_id) {
                    self.last_diagnosis_service_id = last_diagnosis_service_id;
                    self.remaining_polls = 2;
                } else {
                    self.remaining_polls--;
                }

                if (notification && notification.SaleToPOIResponse.MessageHeader.ServiceID == self.most_recent_service_id) {
                    var response = notification.SaleToPOIResponse.PaymentResponse.Response;
                    var additional_response = new URLSearchParams(response.AdditionalResponse);

                    if (response.Result == 'Success') {
                        var config = self.pos.config;
                        var payment_response = notification.SaleToPOIResponse.PaymentResponse;
                        var payment_result = payment_response.PaymentResult;

                        var cashier_receipt = payment_response.PaymentReceipt.find(function (receipt) {
                            return receipt.DocumentQualifier == 'CashierReceipt';
                        });

                        if (cashier_receipt) {
                            line.set_cashier_receipt(self._convert_receipt_info(cashier_receipt.OutputContent.OutputText));
                        }

                        var customer_receipt = payment_response.PaymentReceipt.find(function (receipt) {
                            return receipt.DocumentQualifier == 'CustomerReceipt';
                        });

                        if (customer_receipt) {
                            line.set_receipt_info(self._convert_receipt_info(customer_receipt.OutputContent.OutputText));
                        }

                        var tip_amount = payment_result.AmountsResp.TipAmount;

                        line.transaction_id = additional_response.get('pspReference');
                        line.card_type = additional_response.get('cardType');
                        line.cardholder_name = additional_response.get('cardHolderName') || '';
                        resolve(true);
                    } else {
                        var message = additional_response.get('message');
                        self._show_error(_.str.sprintf(_t('Message from Cardknox: %s'), message));

                        // this means the transaction was cancelled by pressing the cancel button on the device
                        if (message.startsWith('108 ')) {
                            resolve(false);
                        } else {
                            line.set_payment_status('retry');
                            reject();
                        }
                    }
                } else if (self.remaining_polls <= 0) {
                    self._show_error(_t('The connection to your payment terminal failed. Please check if it is still connected to the internet.'));
                    self._cardknox_cancel();
                    resolve(false);
                } else {
                    line.set_payment_status('waitingCard')
                }
            });
        },

        start_get_status_polling(response_ref) {
            var self = this;
            var res = new Promise(function (resolve, reject) {
                // clear previous intervals just in case, otherwise
                // it'll run forever
                clearTimeout(self.polling);
                self._poll_for_response(response_ref, resolve, reject);
                self.polling = setInterval(function () {
                    self._poll_for_response(response_ref, resolve, reject);
                }, 5500);
            });

            // make sure to stop polling when we're done
            res.finally(function () {
                self._reset_state();
            });

            return res;
        },

        _show_error: function (msg, title) {
            if (!title) {
                title =  _t('Cardknox Error');
            }
            Gui.showPopup('ErrorPopup',{
                'title': title,
                'body': msg,
            });
        },

    });

    return PaymentCardknox;

});

