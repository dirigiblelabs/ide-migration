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
migrationLaunchView.controller('NeoCredentialsViewController', ['$scope', '$messageHub', 'migrationDataState', function ($scope, $messageHub, migrationDataState) {
    $scope.migrationDataState = migrationDataState;
    $scope.isVisible = true;
    $scope.passwordVisible = false;
    $scope.authCodeVisible = false;
    $scope.regionDropdownText = "---Please select---";
    $scope.regions = [
        { name: 'Australia (Sydney) | ap1.hana.ondemand.com', region: 'ap1.hana.ondemand.com' },
        { name: 'Europe (Rot) | hana.ondemand.com', region: 'hana.ondemand.com' },
        { name: 'Europe (Rot) EU1 | eu1.hana.ondemand.com', region: 'eu1.hana.ondemand.com' },
        { name: 'Europe (Frankfurt) | eu2.hana.ondemand.com', region: 'eu2.hana.ondemand.com' },
        { name: 'Europe (Amsterdam) | eu3.hana.ondemand.com', region: 'eu3.hana.ondemand.com' },
        { name: 'Japan (Tokyo) | jp1.hana.ondemand.com', region: 'jp1.hana.ondemand.com' },
        { name: 'US East (Ashburn) | us1.hana.ondemand.com', region: 'us1.hana.ondemand.com' },
        { name: 'US East (Sterling) | us3.hana.ondemand.com', region: 'us3.hana.ondemand.com' }
    ];
    $scope.regionList = $scope.regions;

    $scope.userInput = function () {
        if (migrationDataState.neoHostName && migrationDataState.neoSubaccount && migrationDataState.neoUsername && migrationDataState.neoPassword) {
            $scope.$parent.setNextEnabled(true);
        } else {
            $scope.$parent.setNextEnabled(false);
        };
    };

    $scope.showPassword = function () {
        $scope.passwordVisible = !$scope.passwordVisible;
    };

    $scope.showAuthCode = function () {
        $scope.authCodeVisible = !$scope.authCodeVisible;
    };

    $scope.regionSelected = function (regionObject) {
        migrationDataState.neoHostName = regionObject.region;

            if (regionObject.isUserEnteredRegion) {
              $scope.regionDropdownText = regionObject.region;
            } else {
              $scope.regionDropdownText = regionObject.name;
            }

            $scope.$parent.setFinishEnabled(true);
        };

    $scope.filterRegions = function () {
            if ($scope.regionSearch) {
                let filtered = [];
                let alreadyHaveUserEnteredRegion = false;
                for (let i = 0; i < $scope.regions.length; i++) {
                    if ($scope.regions[i].name.toLowerCase().includes($scope.regionSearch.toLowerCase())) {
                        const region = $scope.regions[i];
                        filtered.push(region);

                        if (region.region === $scope.regionSearch) {
                          alreadyHaveUserEnteredRegion = true;
                        }
                    }
                }

                if (!alreadyHaveUserEnteredRegion) {
                  filtered.push({name: 'Use "' + $scope.regionSearch + '" as a region', region: $scope.regionSearch, isUserEnteredRegion: true})
                }

                $scope.regionList = filtered;
            } else {
                $scope.regionList = $scope.regions;
            }
        };

    $messageHub.on('migration.neo-credentials', function (msg) {
        if ("isVisible" in msg.data) {
            $scope.$apply(function () {
                $scope.isVisible = msg.data.isVisible;
                if (msg.data.isVisible) {
                    $scope.userInput();
                    $scope.$parent.setPreviousVisible(false);
                    $scope.$parent.setPreviousEnabled(true);
                    $scope.$parent.setNextVisible(true);
                    $scope.$parent.setFinishVisible(false);
                }
            });
        }
    }.bind(this));
}]);