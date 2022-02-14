/*
 * Copyright (c) 2021 SAP SE or an SAP affiliate company and XSK contributors
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Apache License, v2.0
 * which accompanies this distribution, and is available at
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * SPDX-FileCopyrightText: 2021 SAP SE or an SAP affiliate company and XSK contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { process } from "@dirigible/bpm";
import { MigrationService } from "../api/migration-service.mjs";
import { TrackService } from "../api/track-service.mjs";

export class HandleDeployablesTask {
    execution = process.getExecutionContext();
    trackService = new TrackService();

    run() {
        try {
            process.setVariable(
                this.execution.getId(),
                "migrationState",
                "HANDLE_DEPLOYABLES_EXECUTING"
            );
            this.trackService.updateMigrationStatus("HANDLE DEPLOYABLES EXECUTING");
            const userDataJson = process.getVariable(this.execution.getId(), "userData");
            const userData = JSON.parse(userDataJson);

            const migrationService = new MigrationService();
            for (const deliveryUnit of userData.du) {
                const locals = deliveryUnit.locals;
                if (!(locals && locals.length > 0)) {
                    continue;
                }
                let deployables = [];
                for (const local of locals) {
                    deployables = migrationService.collectDeployables(
                        userData.workspace,
                        local.repositoryPath,
                        local.runLocation,
                        local.projectName,
                        deployables
                    );
                }

        // Get names of projects with generated synonyms and add them to deployables
        const projectsWithSynonyms = migrationService.getProjectsWithSynonyms(locals);
        if (projectsWithSynonyms) {
            for (const projectName of projectsWithSynonyms) {
                const hdbSynonymFilePath = migrationService.getSynonymFilePath(projectName);
                const hdbPublicSynonymFilePath = migrationService.getPublicSynonymFilePath(projectName);
                const projectDeployables = deployables.find((x) => x.projectName === projectName).artifacts;

                        projectDeployables.push(hdbSynonymFilePath);
                        projectDeployables.push(hdbPublicSynonymFilePath);
                    }
                }

                deliveryUnit["deployableArtifactsResult"] =
                    migrationService.handlePossibleDeployableArtifacts(
                        userData.workspace,
                        deployables
                    );
            }
            process.setVariable(this.execution.getId(), "userData", JSON.stringify(userData));
            process.setVariable(this.execution.getId(), "migrationState", "HANDLE_DEPLOYABLES_EXECUTED");
            this.trackService.updateMigrationStatus("HANDLE DEPLOYABLES EXECUTED");
        } catch (e) {
            console.log("HANDLE_DEPLOYABLES failed with error:");
            console.log(e.message);
            process.setVariable(this.execution.getId(), "migrationState", "HANDLE_DEPLOYABLES_FAILED");
            this.trackService.updateMigrationStatus("HANDLE DEPLOYABLES FAILED");
            process.setVariable(
                this.execution.getId(),
                "HANDLE_DEPLOYABLES_FAILED_REASON",
                e.toString()
            );
        }
    }
}
