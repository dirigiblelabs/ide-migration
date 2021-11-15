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
var migrationLaunchView = angular.module('migration-launch', []);

migrationLaunchView.factory('$messageHub', [function () {
    var messageHub = new FramesMessageHub();
    var announceAlert = function (title, message, type) {
        messageHub.post({
            data: {
                title: title,
                message: message,
                type: type
            }
        }, 'ide.alert');
    };
    var announceAlertError = function (title, message) {
        announceAlert(title, message, "error");
    };
    var message = function (evtName, data) {
        messageHub.post({ data: data }, evtName);
    };
    var on = function (topic, callback) {
        messageHub.subscribe(callback, topic);
    };
    return {
        announceAlert: announceAlert,
        announceAlertError: announceAlertError,
        message: message,
        on: on
    };
}]);

migrationLaunchView.controller('MigrationLaunchViewController', ['$scope', '$messageHub', function ($scope, $messageHub) {
    $scope.steps = [
        { id: 1, name: "SAP BTP Neo Credentials", topicId: "migration.neo-credentials" },
        { id: 2, name: "SAP HANA Credentials", topicId: "migration.hana-credentials" },
        { id: 3, name: "Delivery Units", topicId: "migration.delivery-unit" },
        { id: 4, name: "Migration", topicId: "migration.start-migration" },
    ];
    $scope.bottomNavHidden = false;
    $scope.previousDisabled = false;
    $scope.nextDisabled = true;
    $scope.previousVisible = false;
    $scope.nextVisible = true;
    $scope.finishVisible = false;
    $scope.finishDisabled = true;
    $scope.currentStep = $scope.steps[0];

    $scope.schemaName = null;
    $scope.dbUsername = null;
    $scope.dbPassword = null;
    
    $scope.neoUsername = null;
    $scope.neoPassword = null;
    $scope.neoAuthCode = null;
    $scope.neoSubaccount = null;
    $scope.neoHostName = null;
    
    $scope.selectedDeliveyUnit = null;
    $scope.selectedWorkspace = null;

    $scope.setFinishVisible = function (visible) {
        $scope.finishVisible = visible;
    };

    $scope.setFinishEnabled = function (enabled) {
        $scope.finishDisabled = !enabled;
    };

    $scope.setNextVisible = function (visible) {
        $scope.nextVisible = visible;
    };

    $scope.setNextEnabled = function (enabled) {
        $scope.nextDisabled = !enabled;
    };

    $scope.setPreviousVisible = function (visible) {
        $scope.previousVisible = visible;
    };

    $scope.setPreviousEnabled = function (enabled) {
        $scope.previousDisabled = !enabled;
    };

    $scope.setBottomNavEnabled = function (enabled) {
        $scope.bottomNavHidden = !enabled;
    };

    $scope.nextClicked = function () {
        $messageHub.message($scope.currentStep.topicId, { isVisible: false });
        for (let i = 0; i < $scope.steps.length; i++) {
            if ($scope.steps[i].id > $scope.currentStep.id) {
                $scope.currentStep = $scope.steps[i];
                break;
            }
        };
        $messageHub.message($scope.currentStep.topicId, { isVisible: true });
    };

    $scope.previousClicked = function () {
        $messageHub.message($scope.currentStep.topicId, { isVisible: false });
        $scope.revertStep();
        $messageHub.message($scope.currentStep.topicId, { isVisible: true });
    };

    $scope.revertStep = function () {
        for (let i = $scope.steps.length - 1; i >= 0; i--) {
            if ($scope.steps[i].id < $scope.currentStep.id) {
                $scope.currentStep = $scope.steps[i];
                break;
            }
        };
    };

    $scope.finishClicked = function () {
        $messageHub.message($scope.currentStep.topicId, { isVisible: false });
        $scope.currentStep = $scope.steps[$scope.steps.length - 1];
        $messageHub.message($scope.currentStep.topicId, { isVisible: true });
        $scope.bottomNavHidden = true;
    };

    $scope.isStepActive = function (stepId) {
        if (stepId == $scope.currentStep.id)
            return "active";
        else if (stepId < $scope.currentStep.id)
            return "done";
        else
            return "inactive";
    }

    $messageHub.on('migration.launch', function (msg) {
    }.bind(this));
}]);