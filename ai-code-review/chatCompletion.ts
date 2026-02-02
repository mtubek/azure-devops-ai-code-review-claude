import tl = require('azure-pipelines-task-lib/task');
import Anthropic from '@anthropic-ai/sdk';

export class ChatCompletion {
    private readonly systemMessage: string = '';

    constructor(
        private _anthropic: Anthropic,
        private _model: string,
        private _responseLanguage: string = 'Polish',
        checkForBugs: boolean = false,
        checkForPerformance: boolean = false,
        checkForBestPractices: boolean = false,
        additionalPrompts: string[] = [],
        private _maxTokens: number = 16384,
        numberOfFilesToReview: number = 1
     ) {
        const languageInstruction = this.getLanguageInstruction(_responseLanguage);

        this.systemMessage = `Your task is to act as a code reviewer of a Pull Request.

        ${languageInstruction}

        ${numberOfFilesToReview > 1 ? '- Generate high-level summary and a technical walkthrough of all pull request changes' : null}
        ${checkForBugs ? '- If there are any bugs, highlight them.' : null}
        ${checkForPerformance ? '- If there are major performance problems, highlight them.' : null}
        ${checkForBestPractices ? '- Provide details on missed use of best-practices.' : null}
        ${additionalPrompts.length > 0 ? additionalPrompts.map(str => `- ${str}`).join('\n') : null}
        - Do not highlight minor issues and nitpicks.
        - Only provide instructions for improvements.
        - If you have no specific instructions for a certain topic, then do not mention the topic at all.
        - If you have no instructions for code then respond with NO_COMMENT only, otherwise provide your instructions.

        You are provided with the code changes (diffs) in a unidiff format.

        The response should be in markdown format:
        - Use bullet points if you have multiple comments. Utilize emojis to make your comments more engaging.
        - Use the code block syntax for larger code snippets but do not wrap the whole response in a code block
        - Use inline code syntax for smaller inline code snippets
`
        if (numberOfFilesToReview > 1) {
            this.systemMessage += `
        Create table that lists the files and their respective comments. For example:

        Summary of changes: ...

        Feedback on files:
        | File Name | Comments |
        | --- | --- |
        | file1.cs | - comment1 |
        | file2.js | - comment2<br>- comment3 |
        | file3.py | No comments |
        | styles.css | - comment4 |
`}
    }

    public async PerformCodeReview(diff: string, fileName: string):
            Promise<{response: string, promptTokens: number, completionTokens: number}> {

        // Check if diff is empty
        if (!diff || diff.trim().length === 0) {
            tl.warning(`Skipping ${fileName} - no changes detected`);
            return {response: '', promptTokens: 0, completionTokens: 0};
        }

        if (!this.doesMessageExceedTokenLimit(diff + this.systemMessage, this._maxTokens)) {

            const message = await this._anthropic.messages.create({
                model: this._model,
                max_tokens: this._maxTokens,
                system: this.systemMessage,
                messages: [
                    {
                        role: 'user',
                        content: diff
                    }
                ]
            });

            const tokenUsageString = JSON.stringify(message.usage);
            console.info(`Usage: ${tokenUsageString}`);

            if (message.content && message.content.length > 0 && message.content[0].type === 'text') {
                return {
                    response: message.content[0].text,
                    promptTokens: message.usage.input_tokens,
                    completionTokens: message.usage.output_tokens,
                };
            }
        }

        tl.warning(`Unable to process diff for ${fileName} as it exceeds token limits.`)
        return {response: '', promptTokens: 0, completionTokens: 0};
    }

    private doesMessageExceedTokenLimit(message: string, tokenLimit: number): boolean {
        // Rough approximation: ~4 characters per token
        // Claude's actual tokenization may vary, but this provides a reasonable estimate
        const estimatedTokens = Math.ceil(message.length / 4);
        return estimatedTokens > tokenLimit;
    }

    private getLanguageInstruction(language: string): string {
        const languageMap: { [key: string]: string } = {
            'Polish': 'IMPORTANT: Respond in Polish language (Polski). All your comments and feedback must be written in Polish.',
            'English': 'IMPORTANT: Respond in English language. All your comments and feedback must be written in English.',
            'German': 'IMPORTANT: Respond in German language (Deutsch). All your comments and feedback must be written in German.',
            'French': 'IMPORTANT: Respond in French language (Français). All your comments and feedback must be written in French.',
            'Spanish': 'IMPORTANT: Respond in Spanish language (Español). All your comments and feedback must be written in Spanish.'
        };

        return languageMap[language] || languageMap['Polish'];
    }

}
