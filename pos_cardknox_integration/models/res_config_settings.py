# -*- coding: utf-8 -*-

from odoo import models, fields, api


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    module_pos_cardknox_integration = fields.Boolean(string="Cardknox Payment Terminal")

    def set_values(self):
        super(ResConfigSettings, self).set_values()
        payment_methods = self.env['pos.payment.method']
        if not self.env['ir.config_parameter'].sudo().get_param('pos_cardknox_integration.module_pos_cardknox_integration'):
            payment_methods |= payment_methods.search([('use_payment_terminal', '=', 'cardknox')])
            payment_methods.write({'use_payment_terminal': False})

