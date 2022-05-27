odoo.define('pos_cardknox_integration.models', function (require) {

    var models = require('point_of_sale.models');
    var PaymentCardknox = require('pos_cardknox_integration.payment');

    models.register_payment_method('cardknox', PaymentCardknox);
    models.load_fields('pos.payment.method', 'cardknox_xkey', 'cardknox_xsoftware_name', 'cardknox_xversion', 'cardknox_xsoftware_version');

    const superPaymentline = models.Paymentline.prototype;
    models.Paymentline = models.Paymentline.extend({
        initialize: function(attr, options) {
            superPaymentline.initialize.call(this,attr,options);
            this.terminalServiceId = this.terminalServiceId  || null;
        },
        export_as_JSON: function(){
            const json = superPaymentline.export_as_JSON.call(this);
            json.terminal_service_id = this.terminalServiceId;
            return json;
        },
        init_from_JSON: function(json){
            superPaymentline.init_from_JSON.apply(this,arguments);
            this.terminalServiceId = json.terminal_service_id;
        },
        setTerminalServiceId: function(id) {
            this.terminalServiceId = id;
        }
    });

});

