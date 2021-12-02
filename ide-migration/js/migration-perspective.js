/*
 * Copyright (c) 2010-2021 SAP SE or an SAP affiliate company and Eclipse Dirigible contributors
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v2.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-FileCopyrightText: 2010-2021 SAP SE or an SAP affiliate company and Eclipse Dirigible contributors
 * SPDX-License-Identifier: EPL-2.0
 */
let migrationPerspective = angular.module('migration', ['ngResource', 'ideUiCore']);

migrationPerspective.config(["messageHubProvider", function (messageHubProvider) {
    messageHubProvider.evtNamePrefix = 'migration';
}]);

migrationPerspective.factory('$messageHub', [function () {
    let messageHub = new FramesMessageHub();
    let message = function (evtName, data) {
        messageHub.post({data: data}, evtName);
    };
    let on = function (topic, callback) {
        messageHub.subscribe(callback, topic);
    };
    return {
        message: message,
        on: on
    };
}]);

migrationPerspective.controller('MigrationViewController', ['Layouts', function (Layouts) {
    this.layoutModel =
        {
            views: ['migration-launch', 'migration-statistic'],
            viewSettings: {
                'migration-launch': {isClosable: false},
                'migration-statistic': {isClosable: false}
            },
            layoutSettings: {
                hasHeaders: true,
                showCloseIcon: false
            }
        }
    ;
}]);
