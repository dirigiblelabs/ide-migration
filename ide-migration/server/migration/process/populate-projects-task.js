const process = require("bpm/v4/process");
const execution = process.getExecutionContext();
const MigrationService = require("ide-migration/server/migration/api/migration-service");

const TrackService = require("ide-migration/server/migration/api/track-service");
const trackService = new TrackService();

try {
    process.setVariable(execution.getId(), "migrationState", "POPULATING_PROJECTS");
    trackService.updateMigrationStatus("POPULATING PROJECTS");
    const userDataJson = process.getVariable(execution.getId(), "userData");
    const userData = JSON.parse(userDataJson);

    const migrationService = new MigrationService();
    const workspace = userData.workspace;

    for (const deliveryUnit of userData.du) {
        const localFiles = deliveryUnit.locals;
        if (!(localFiles && localFiles.length > 0)) {
            throw "Delivery unit is empty";
        }

        migrationService.addFilesWithoutGenerated(userData, workspace, localFiles);
        migrationService.addGeneratedFiles(userData, deliveryUnit, workspace, localFiles);
        migrationService.modifyFiles(workspace, localFiles);
    }
    process.setVariable(execution.getId(), "migrationState", "MIGRATION_EXECUTED");
    trackService.updateMigrationStatus("MIGRATION EXECUTED");
} catch (e) {
    console.log("POPULATING_PROJECTS failed with error:");
    console.log(e.message);
    console.log(e.stack);
    process.setVariable(execution.getId(), "migrationState", "POPULATING_PROJECTS_FAILED");
    trackService.updateMigrationStatus("POPULATING PROJECTS FAILED");
    process.setVariable(execution.getId(), "POPULATING_PROJECTS_FAILED_REASON", e.toString());
}
