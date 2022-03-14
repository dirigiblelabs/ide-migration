import { workspace as workspaceManager, repository as repositoryManager } from "@dirigible/platform";
import { bytes } from "@dirigible/io";
import { database } from "@dirigible/db";
import { configurations as config } from "@dirigible/core";
import { client as git } from "@dirigible/git";

import { HanaRepository } from "../repository/hana-repository";
import { HanaVisitor } from "./hana-visitor.mjs";
import { getHdiFilePlugins } from "../repository/hdi-plugins";

const HANA_USERNAME = "HANA_USERNAME";
const TransformerFactory = Java.type("javax.xml.transform.TransformerFactory");
const StreamSource = Java.type("javax.xml.transform.stream.StreamSource");
const StreamResult = Java.type("javax.xml.transform.stream.StreamResult");
const StringReader = Java.type("java.io.StringReader");
const ByteArrayInputStream = Java.type("java.io.ByteArrayInputStream");
const ByteArrayOutputStream = Java.type("java.io.ByteArrayOutputStream");
const XSKProjectMigrationInterceptor = Java.type("com.sap.xsk.modificators.XSKProjectMigrationInterceptor");
const XSKHDBCoreFacade = Java.type("com.sap.xsk.hdb.ds.facade.XSKHDBCoreSynchronizationFacade");
const hdbDDModel = "com.sap.xsk.hdb.ds.model.hdbdd.XSKDataStructureCdsModel";
const hdbTableFunctionModel = "com.sap.xsk.hdb.ds.model.hdbtablefunction.XSKDataStructureHDBTableFunctionModel";
const hdbCalculationViewModel = "migration.calc.view.model";
const xskModificator = new XSKProjectMigrationInterceptor();

export class MigrationService {
    repo = null;
    tableFunctionPaths = [];

    synonymFileName = "hdi-synonyms.hdbsynonym";
    publicSynonymFileName = "hdi-public-synonyms.hdbpublicsynonym";

    setupConnection(databaseName, databaseUser, databaseUserPassword, connectionUrl) {
        database.createDataSource(databaseName, "com.sap.db.jdbc.Driver", connectionUrl, databaseUser, databaseUserPassword, null);

        const connection = database.getConnection("dynamic", databaseName);
        this.repo = new HanaRepository(connection);
    }

    getAllDeliveryUnits() {
        if (!this.repo) {
            throw new Error("Repository not initialized");
        }

        return this.repo.getAllDeliveryUnits();
    }

    handlePossibleDeployableArtifacts(workspaceName, deployables) {
        let generatedFiles = [];
        let updatedFiles = [];
        for (const deployable of deployables) {
            if (deployable.artifacts && deployable.artifacts.length > 0) {
                const hdiConfigPath = this.createHdiConfigFile(workspaceName, deployable.project);
                generatedFiles.push(hdiConfigPath);
                let hdiPath = this.createHdiFile(workspaceName, deployable.project, hdiConfigPath, deployable.artifacts);
                generatedFiles.push(hdiPath);
            }
        }

        return { generated: generatedFiles, updated: updatedFiles };
    }

    createHdiConfigFile(workspaceName, project) {
        const hdiConfig = getHdiFilePlugins();

        const projectName = project.getName();
        const hdiConfigPath = `${projectName}.hdiconfig`;
        const hdiConfigJson = JSON.stringify(hdiConfig, null, 4);
        const hdiConfigJsonBytes = bytes.textToByteArray(hdiConfigJson);

        const workspaceCollection = this._getOrCreateTemporaryWorkspaceCollection(workspaceName);
        const projectCollection = this._getOrCreateTemporaryProjectCollection(workspaceCollection, projectName);
        let localResource = projectCollection.createResource(hdiConfigPath, hdiConfigJsonBytes);

        return {
            repositoryPath: localResource.getPath(),
            relativePath: hdiConfigPath,
            projectName: projectName,
        };
    }

    createHdiFile(workspaceName, project, hdiConfigPath, deployables) {
        const projectName = project.getName();
        const defaultHanaUser = config.get(HANA_USERNAME, "DBADMIN");

        const hdi = {
            configuration: `/${projectName}/${hdiConfigPath.relativePath}`,
            users: [defaultHanaUser],
            group: projectName,
            container: projectName,
            deploy: deployables,
            undeploy: [],
        };

        const hdiPath = `${projectName}.hdi`;
        const hdiJson = JSON.stringify(hdi, null, 4);
        const hdiJsonBytes = bytes.textToByteArray(hdiJson);

        const workspaceCollection = this._getOrCreateTemporaryWorkspaceCollection(workspaceName);
        const projectCollection = this._getOrCreateTemporaryProjectCollection(workspaceCollection, projectName);
        let localResource = projectCollection.createResource(hdiPath, hdiJsonBytes);

        return {
            repositoryPath: localResource.getPath(),
            relativePath: hdiPath,
            projectName: projectName,
        };
    }

    copyFilesLocally(workspaceName, lists) {
        const workspaceCollection = this._getOrCreateTemporaryWorkspaceCollection(workspaceName);
        const unmodifiedWorkspaceCollection = this._getOrCreateTemporaryWorkspaceCollection(workspaceName + "_unmodified");
        const hdbFacade = new XSKHDBCoreFacade();

        const locals = [];
        for (const file of lists) {
            let fileRunLocation = file.RunLocation;

            // each file's package id is based on its directory
            // if we do not get only the first part of the package id, we would have several XSK projects created for directories in the same XS app
            const projectName = file.packageId.split(".")[0];

            if (fileRunLocation.startsWith("/" + projectName)) {
                // remove package id from file location in order to remove XSK project and folder nesting
                fileRunLocation = fileRunLocation.slice(projectName.length + 1);
            }
            let content = this.repo.getContentForObject(file._name, file._packageName, file._suffix);

            const unmodifiedProjectCollection = this._getOrCreateTemporaryProjectCollection(
                unmodifiedWorkspaceCollection,
                projectName
            );
            const unmodifiedLocalResource = unmodifiedProjectCollection.createResource(fileRunLocation, content);

            if (this._isFileCalculationView(fileRunLocation)) {
                content = this._transformColumnObject(content);
            }

            const projectCollection = this._getOrCreateTemporaryProjectCollection(workspaceCollection, projectName);
            const localResource = projectCollection.createResource(fileRunLocation, content);

            const fileName = this._getFileNameWithExtension(file);
            const filePath = this._getAbsoluteFilePath(file);
            const fileContent = bytes.byteArrayToText(content);

            // Parse current artifacts and generate synonym files for it if necessary
            const parsedData = this._parseArtifact(
                fileName,
                filePath,
                fileContent,
                workspaceCollection.getPath() + "/",
                hdbFacade
            );

            const synonymData = this._handleParsedData(parsedData);
            const hdbSynonyms = this._appendOrCreateSynonymsFile(this.synonymFileName, synonymData.hdbSynonyms, workspaceName, projectName);
            const hdbPublicSynonyms = this._appendOrCreateSynonymsFile(
                this.publicSynonymFileName,
                synonymData.hdbPublicSynonyms,
                workspaceName,
                projectName
            );

            // Add any generated synonym files to locals
            locals.push(...hdbSynonyms);
            locals.push(...hdbPublicSynonyms);

            locals.push({
                repositoryPath: localResource.getPath(),
                relativePath: fileRunLocation,
                projectName: projectName,
                runLocation: file.RunLocation,
            });
        }

        return locals;
    }

    _parseArtifact(fileName, filePath, fileContent, workspacePath, hdbFacade) {
        if (this._isFileCalculationView(fileName)) {
            return this._buildCalcViewModel(fileName);
        }

        return hdbFacade.parseDataStructureModel(
                  fileName,
                  filePath,
                  fileContent,
                  workspacePath
        );
    }

    _getFileNameWithExtension(file) {
        return file._name + "." + file._suffix;
    }

    _getAbsoluteFilePath(file) {
        const filePath = file._packageName.replaceAll(".", "/") + "/";
        return filePath + this._getFileNameWithExtension(file);
    }

    _handleParsedData(parsedData) {
        if (!parsedData) {
            return [];
        }

        const dataModelType = parsedData.getClass().getName();

        var synonyms = [];
        var publicSynonyms = [];
        if (dataModelType == hdbDDModel) {
            for (const tableModel of parsedData.tableModels) {
                const tableModelName = tableModel.getName();
                const tableModelSchema = tableModel.getSchema();
                const hdbSynonym = this._generateHdbSynonym(
                    tableModelName,
                    tableModelSchema
                );

                synonyms.push(hdbSynonym);
            }

            for (const tableTypeModel of parsedData.tableTypeModels) {
                const tableTypeModelName = tableTypeModel.getName();
                const tableTypeModelSchema = tableTypeModel.getSchema();
                const hdbSynonym = this._generateHdbSynonym(
                    tableTypeModelName,
                    tableTypeModelSchema
                );

                synonyms.push(hdbSynonym);
            }
        } else {
            const modelName = parsedData.getName();

            if(dataModelType == hdbTableFunctionModel || dataModelType == hdbCalculationViewModel) {
                const hdbPublicSynonym = this._generateHdbPublicSynonym(modelName);
                publicSynonyms.push(hdbPublicSynonym);
            }
            else {
                const modelSchema = parsedData.getSchema();
                const hdbSynonym = this._generateHdbSynonym(modelName, modelSchema);
                synonyms.push(hdbSynonym);
            }
        }

        return { hdbSynonyms: synonyms, hdbPublicSynonyms: publicSynonyms };
    }

    _buildCalcViewModel(fileName) {
        const calcViewName = fileName.substring(0, fileName.lastIndexOf('.'));
        const calcViewModelClass = {
            getName: () => hdbCalculationViewModel
        }
        const calcViewModel = {
            getName: () => calcViewName,
            getClass: () => calcViewModelClass
        }
        return calcViewModel;
    }

    _generateHdbSynonym(name, schemaName) {
        const trimmedName = name.split(":").pop();
        return {
            name: name,
            value: {
                target: {
                    object: trimmedName,
                    schema: schemaName,
                },
            },
        };
    }

    _generateHdbPublicSynonym(name) {
        return {
            name: name,
            value: {
                target: {
                    object: name,
                },
            },
        };
    }

    _appendOrCreateSynonymsFile(fileName, synonyms, workspaceName, projectName) {
        const synonymLocalPaths = [];

        if (!synonyms) {
            return synonymLocalPaths;
        }

        for (const synonym of synonyms) {
            const synonymResourceAndPaths = this._getOrCreateHdbSynonymFile(workspaceName, projectName, fileName);
            const synonymFile = synonymResourceAndPaths.resource;
            if (synonymResourceAndPaths.localPaths) {
                synonymLocalPaths.push(synonymResourceAndPaths.localPaths);
            }

            const synonymFileContent = synonymFile.getContent();
            const synonymFileContentAsText = bytes.byteArrayToText(synonymFileContent);
            const content = JSON.parse(synonymFileContentAsText);

            content[synonym.name] = synonym.value;

            const newSynonymFileContent = JSON.stringify(content, null, 4);
            const newSynonymFileBytes = bytes.textToByteArray(newSynonymFileContent);

            synonymFile.setContent(newSynonymFileBytes);
        }

        return synonymLocalPaths;
    }

    _isFileCalculationView(filePath) {
        return filePath.endsWith("hdbcalculationview") || filePath.endsWith("calculationview");
    }

    _transformColumnObject(calculationViewXmlBytes) {
        try {
            const columnObjectToResourceUriXslt = `<?xml version="1.0" encoding="UTF8"?>
            <xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

                <xsl:template match="node()|@*">
                    <xsl:copy>
                        <xsl:apply-templates select="node()|@*"/>
                    </xsl:copy>
                </xsl:template>

                <xsl:template match="DataSource[@type='DATA_BASE_TABLE']/columnObject[@columnObjectName]">
                    <xsl:element name="resourceUri">
                        <xsl:value-of select="@columnObjectName"/>
                    </xsl:element>
                </xsl:template>
            </xsl:stylesheet>
        `;

            const factory = TransformerFactory.newInstance();
            const source = new StreamSource(new StringReader(columnObjectToResourceUriXslt));
            const transformer = factory.newTransformer(source);

            const text = new StreamSource(new ByteArrayInputStream(calculationViewXmlBytes));
            const bout = new ByteArrayOutputStream();

            transformer.transform(text, new StreamResult(bout));
            return bout.toByteArray();
        } catch (e) {
            console.log("Error json: " + JSON.stringify(e));
        }
    }

    _getOrCreateTemporaryWorkspaceCollection(workspaceName) {
        const existing = repositoryManager.getCollection(workspaceName);
        if (existing) {
            return existing;
        }

        return repositoryManager.createCollection(workspaceName);
    }

    _getOrCreateTemporaryProjectCollection(workspaceCollection, projectName) {
        const existing = workspaceCollection.getCollection(projectName);
        if (existing) {
            return existing;
        }

        return workspaceCollection.createCollection(projectName);
    }

    _getOrCreateHdbSynonymFile(workspaceName, projectName, hdbSynonymFileName) {
        const workspaceCollection = repositoryManager.getCollection(workspaceName);
        const projectCollection = workspaceCollection.getCollection(projectName);

        var synonymFile = projectCollection.getResource(hdbSynonymFileName);
        if (synonymFile.exists()) {
            return {
                resource: synonymFile,
                localPaths: null,
            };
        }

        synonymFile = projectCollection.createResource(hdbSynonymFileName, bytes.textToByteArray("{}"));
        return {
            resource: synonymFile,
            localPaths: {
                repositoryPath: synonymFile.getPath(),
                relativePath: synonymFile.getPath().split(projectName).pop(),
                projectName: projectName,
                runLocation: synonymFile.getPath().split(workspaceName).pop(),
            },
        };
    }

    createMigratedWorkspace(workspaceName) {
        let workspace;
        if (!workspaceName) {
            workspace = workspaceManager.getWorkspace(workspaceName);
            if (!workspace) {
                workspaceManager.createWorkspace(workspaceName);
            }
        }
        workspace = workspaceManager.getWorkspace(workspaceName);

        return workspace;
    }

    collectDeployables(workspaceName, filePath, runLocation, projectName, oldDeployables) {
        let workspace = workspaceManager.getWorkspace(workspaceName);
        if (!workspace) {
            workspaceManager.createWorkspace(workspaceName);
            workspace = workspaceManager.getWorkspace(workspaceName);
        }

        const deployables = oldDeployables;

        let project = workspace.getProject(projectName);
        if (!project) {
            workspace.createProject(projectName);
            project = workspace.getProject(projectName);
        }

        if (!deployables.find((x) => x.projectName === projectName)) {
            deployables.push({
                project: project,
                projectName: projectName,
                artifacts: [],
            });
        }

        if (
            filePath.endsWith(".hdbcalculationview") ||
            filePath.endsWith(".calculationview") ||
            filePath.endsWith(".analyticprivilege") ||
            filePath.endsWith(".hdbanalyticprivilege") ||
            filePath.endsWith(".hdbflowgraph")
        ) {
            deployables.find((x) => x.projectName === projectName).artifacts.push(runLocation);
        }

        return deployables;
    }

    getSynonymFilePath(projectName) {
        return "/" + projectName + "/" + this.synonymFileName;
    }

    getPublicSynonymFilePath(projectName) {
        return "/" + projectName + "/" + this.publicSynonymFileName;
    }

    getProjectsWithSynonyms(locals) {
        const projectNames = [];
        for (const local of locals) {
            const projectSynonymPath = this.getSynonymFilePath(local.projectName);
            const projectPublicSynonymPath = this.getPublicSynonymFilePath(local.projectName);

            if (local.runLocation === projectSynonymPath || local.runLocation === projectPublicSynonymPath) {
                if (!projectNames.includes(local.projectName)) {
                    projectNames.push(local.projectName);
                }
            }
        }
        return projectNames;
    }
    checkExistingSynonymTypes(locals) {
        const synonyms = [];
        for (const local of locals) {
            const projectSynonymPath = this.getSynonymFilePath(local.projectName);
            const projectPublicSynonymPath = this.getPublicSynonymFilePath(local.projectName);

            if (local.runLocation === projectSynonymPath) {
                if (!synonyms.includes(projectSynonymPath)) {
                    synonyms.push(projectSynonymPath);
                }
            }
            if (local.runLocation === projectPublicSynonymPath) {
                if (!synonyms.includes(projectPublicSynonymPath)) {
                    synonyms.push(projectPublicSynonymPath);
                }
            }
        }
        return synonyms;
    }

    addFileToWorkspace(workspaceName, repositoryPath, relativePath, projectName) {
        const workspace = workspaceManager.getWorkspace(workspaceName);
        const project = workspace.getProject(projectName);

        if (project.existsFile(relativePath)) {
            project.deleteFile(relativePath);
        }

        const projectFile = project.createFile(relativePath);
        const resource = repositoryManager.getResource(repositoryPath);

        if (
            relativePath.endsWith(".hdbcalculationview") ||
            relativePath.endsWith(".calculationview") ||
            repositoryPath.endsWith(".hdbcalculationview") ||
            repositoryPath.endsWith(".calculationview")
        ) {
            const modifiedContent = xskModificator.modify(resource.getContent());
            projectFile.setContent(modifiedContent);
        } else {
            projectFile.setContent(resource.getContent());
        }
    }

    getAllFilesForDU(du) {
        let context = {};
        const filesAndPackagesObject = this.repo.getAllFilesForDu(context, du);
        if (!filesAndPackagesObject) {
            return null;
        }
        return filesAndPackagesObject.files;
    }

    _visitCollection(project, collection, parentPath) {
        let resNames = collection.getResourcesNames();
        for (const resName of resNames) {
            var path = collection.getPath() + "/" + resName;
            let oldProjectRelativePath = parentPath + "/" + resName;

            if (path.endsWith(".hdbtablefunction") || path.endsWith(".hdbscalarfunction")) {
                let resource = collection.getResource(resName);
                let content = resource.getText();

                let visitor = new HanaVisitor(content);
                visitor.visit();
                visitor.removeSchemaRefs();
                visitor.removeViewRefs();

                resource.setText(visitor.content);
                project.getFile(oldProjectRelativePath).setText(visitor.content);
                this.tableFunctionPaths.push(oldProjectRelativePath);
            }
        }

        let collectionsNames = collection.getCollectionsNames();
        for (const name of collectionsNames) {
            let nestedCollection = collection.getCollection(name);
            this._visitCollection(project, nestedCollection, parentPath + "/" + name);
        }
    }

    handleHDBTableFunctions(workspaceName, projectName) {
        const workspaceCollection = this._getOrCreateTemporaryWorkspaceCollection(workspaceName);
        const projectCollection = this._getOrCreateTemporaryProjectCollection(workspaceCollection, projectName);

        const workspace = workspaceManager.getWorkspace(workspaceName);
        const project = workspace.getProject(projectName);
        this._visitCollection(project, projectCollection, ".");

        console.log("Adding tablefunctions to hdi file...");
        this._addTableFunctionsToHDI(project, projectName, projectCollection);
        this._resetTableFunctionPaths();
    }

    _resetTableFunctionPaths() {
        this.tableFunctionPaths = [];
    }

    _addTableFunctionsToHDI(project, projectName, projectCollection) {
        const hdiPath = `${projectName}.hdi`;
        const hdiFile = project.getFile(hdiPath);
        const hdiObject = JSON.parse(hdiFile.getText());

        for (const path of this.tableFunctionPaths) {
            let trimmed = path;
            if (path.startsWith("./")) {
                trimmed = path.substring(2);
            }
            hdiObject["deploy"].push(`/${projectName}/${trimmed}`);
        }

        const hdiJson = JSON.stringify(hdiObject, null, 4);
        let resource = projectCollection.getResource(hdiPath);
        resource.setText(hdiJson);
        hdiFile.setText(hdiJson);
    }

    addFilesWithoutGenerated(userData, workspace, localFiles) {
        for (const localFile of localFiles) {
            this.addFileToWorkspace(workspace, localFile.repositoryPath, localFile.relativePath, localFile.projectName);
            const projectName = localFile.projectName;
            let repos = git.getGitRepositories(workspace);
            let repoExists = false;
            for (const repo of repos) {
                if (repo.getName() === projectName) {
                    repoExists = true;
                    break;
                }
            }
            if (repoExists) {
                git.commit("migration", "", userData.workspace, projectName, "Overwrite existing project", true);
            } else {
                console.log("Initializing repository...");
                git.initRepository("migration", "", workspace, projectName, projectName, "Migration initial commit");
            }
        }
    }

    addGeneratedFiles(userData, deliveryUnit, workspace, localFiles) {
        for (const localFile of localFiles) {
            const projectName = localFile.projectName;
            const generatedFiles = deliveryUnit["deployableArtifactsResult"]["generated"].filter((x) => x.projectName === projectName);
            for (const generatedFile of generatedFiles) {
                this.addFileToWorkspace(workspace, generatedFile.repositoryPath, generatedFile.relativePath, generatedFile.projectName);
            }
            git.commit("migration", "", userData.workspace, projectName, "Artifacts handled", true);
            this.handleHDBTableFunctions(workspace, projectName);
            git.commit("migration", "", userData.workspace, projectName, "HDB Functions handled", true);
        }
    }

    modifyFiles(workspace, localFiles) {
        for (const localFile of localFiles) {
            const projectName = localFile.projectName;
            xskModificator.interceptXSKProject(workspace, projectName);
        }
    }
}
