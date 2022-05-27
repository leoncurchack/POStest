# -*- coding: utf-8 -*-
{
    'name': "POS Cardknox Terminal Integration",
    'summary': """
        POS Cardknox Terminal Integration""",
    'description': """
        Integrating Cardknox payment gateway with POS
    """,

    'author': "Pragmatic TechSoft Pvt Ltd.",
    'website': "www.pragtech.co.in",
    'category': 'Point of Sale',
    'version': '15.0.1.0.0',
    'depends': ['point_of_sale'],

    'data': [
        'views/pos_res_config_settings_view.xml',
        'views/pos_payment_method_view.xml',
    ],
    'assets': {
        'point_of_sale.assets': [
            'pos_cardknox_integration/static/**/*',
        ],
    },

    'license': 'LGPL-3',
    'auto_install': False,
    'application': True,
    'installable': True,
}

