import * as tl from "azure-pipelines-task-lib/task";
import { SimpleGit, SimpleGitOptions, simpleGit } from "simple-git";
import binaryExtensions from "./binaryExtensions";

export class Repository {

    private gitOptions: Partial<SimpleGitOptions> = {
        baseDir: `${tl.getVariable('System.DefaultWorkingDirectory')}`,
        binary: 'git'
    };

    private readonly _repository: SimpleGit;

    constructor() {
        this._repository = simpleGit(this.gitOptions);
        this._repository.addConfig('core.pager', 'cat');
        this._repository.addConfig('core.quotepath', 'false');

        // Configure git to use Azure DevOps access token for authentication
        const accessToken = tl.getVariable('System.AccessToken');
        if (accessToken) {
            const encodedToken = Buffer.from(`PAT:${accessToken}`).toString('base64');
            this._repository.addConfig('http.extraheader', `AUTHORIZATION: basic ${encodedToken}`);
        }
    }

    public async GetChangedFiles(fileExtensions: string | undefined, filesToExclude: string | undefined): Promise<string[]> {
        // Try to fetch latest changes, but don't fail if it doesn't work
        // Azure Pipelines should already have the necessary commits checked out
        try {
            await this._repository.fetch();
        } catch (error) {
            console.log('Warning: Could not fetch from remote. Using local repository state.');
        }

        let targetBranch = this.GetTargetBranch();

        let diffs = await this._repository.diff([targetBranch, '--name-only', '--diff-filter=AM']);
        let files = diffs.split('\n').filter(line => line.trim().length > 0);
        let filesToReview = files.filter(file => !binaryExtensions.includes(file.slice((file.lastIndexOf(".") - 1 >>> 0) + 2)));

        if(fileExtensions) {
            console.log(`File extensions specified: ${fileExtensions}`);
            let fileExtensionsToInclude = fileExtensions.trim().split(',');
            filesToReview = filesToReview.filter(file => fileExtensionsToInclude.includes(file.substring(file.lastIndexOf('.'))));
        } else {
            console.log('No file extensions specified. All files will be reviewed.');
        }

        if(filesToExclude) {
            let fileNamesToExclude = filesToExclude.trim().split(',')
            filesToReview = filesToReview.filter(file => !fileNamesToExclude.includes(file.split('/').pop()!.trim()))
        }

        return filesToReview;
    }

    public async GetDiff(fileName: string): Promise<string> {
        let targetBranch = this.GetTargetBranch();

        let diff = await this._repository.diff([targetBranch, '--', fileName]);

        console.log(`Diff for ${fileName}: ${diff.length} characters`);
        if (!diff || diff.trim().length === 0) {
            console.log(`Warning: Empty diff for file ${fileName} against branch ${targetBranch}`);
        }

        return diff;
    }

    private GetTargetBranch(): string {
        let targetBranchName = tl.getVariable('System.PullRequest.TargetBranchName');

        if (!targetBranchName) {
            targetBranchName = tl.getVariable('System.PullRequest.TargetBranch')?.replace('refs/heads/', '');
        }

        if (!targetBranchName) {
            throw new Error(`Could not find target branch`)
        }

        return `origin/${targetBranchName}`;
    }
}
