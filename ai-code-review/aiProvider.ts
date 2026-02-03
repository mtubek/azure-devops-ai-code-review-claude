import tl = require('azure-pipelines-task-lib/task');
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// Lista modeli Codex, które używają responses API
const CODEX_MODELS = [
    'gpt-5-codex',
    'gpt-5.1-codex',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
    'gpt-5.2-codex',
    'codex-mini-latest'
];

export function isCodexModel(modelName: string): boolean {
    return CODEX_MODELS.some(codexModel => modelName.includes(codexModel));
}

export interface ReviewResult {
    response: string;
    promptTokens: number;
    completionTokens: number;
    cost?: number;
}

export interface AIProvider {
    performCodeReview(diff: string, fileName: string): Promise<ReviewResult>;
    getProviderName(): string;
    getTotalCost(): number;
    getTotalTokens(): { prompt: number; completion: number };
}

export class ClaudeProvider implements AIProvider {
    private readonly systemMessage: string;
    private totalPromptTokens: number = 0;
    private totalCompletionTokens: number = 0;

    constructor(
        private _anthropic: Anthropic,
        private _model: string,
        private _responseLanguage: string,
        private _maxTokens: number,
        private _promptTokensPrice: number,
        private _completionTokensPrice: number,
        systemMessage: string
    ) {
        this.systemMessage = systemMessage;
    }

    getProviderName(): string {
        return 'Claude';
    }

    getTotalCost(): number {
        const promptCost = this.totalPromptTokens * (this._promptTokensPrice / 1000000);
        const completionCost = this.totalCompletionTokens * (this._completionTokensPrice / 1000000);
        return promptCost + completionCost;
    }

    getTotalTokens(): { prompt: number; completion: number } {
        return {
            prompt: this.totalPromptTokens,
            completion: this.totalCompletionTokens
        };
    }

    async performCodeReview(diff: string, fileName: string): Promise<ReviewResult> {
        if (!diff || diff.trim().length === 0) {
            tl.warning(`[Claude] Pomijam ${fileName} - brak zmian`);
            return { response: '', promptTokens: 0, completionTokens: 0 };
        }

        if (this.doesMessageExceedTokenLimit(diff + this.systemMessage, this._maxTokens)) {
            tl.warning(`[Claude] Nie można przetworzyć ${fileName} - przekroczono limit tokenów`);
            return { response: '', promptTokens: 0, completionTokens: 0 };
        }

        try {
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

            console.info(`[Claude] Użycie: ${JSON.stringify(message.usage)}`);

            if (message.content && message.content.length > 0 && message.content[0].type === 'text') {
                const promptTokens = message.usage.input_tokens;
                const completionTokens = message.usage.output_tokens;

                this.totalPromptTokens += promptTokens;
                this.totalCompletionTokens += completionTokens;

                return {
                    response: message.content[0].text,
                    promptTokens: promptTokens,
                    completionTokens: completionTokens,
                };
            }

            return { response: '', promptTokens: 0, completionTokens: 0 };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            tl.error(`[Claude] Błąd dla modelu "${this._model}": ${errorMessage}`);

            if (errorMessage.includes('model') || errorMessage.includes('404')) {
                tl.error(`[Claude] Model "${this._model}" nie istnieje lub nie jest obsługiwany.`);
                tl.error(`[Claude] Dostępne modele: claude-3-5-sonnet-20241022, claude-3-opus-20240229, claude-3-sonnet-20240229, claude-3-haiku-20240307`);
            }

            throw error;
        }
    }

    private doesMessageExceedTokenLimit(message: string, tokenLimit: number): boolean {
        const estimatedTokens = Math.ceil(message.length / 4);
        return estimatedTokens > tokenLimit;
    }
}

export class OpenAIProvider implements AIProvider {
    private readonly systemMessage: string;
    private totalPromptTokens: number = 0;
    private totalCompletionTokens: number = 0;

    constructor(
        private _openai: OpenAI,
        private _model: string,
        private _maxTokens: number,
        private _promptTokensPrice: number,
        private _completionTokensPrice: number,
        systemMessage: string
    ) {
        this.systemMessage = systemMessage;
    }

    getProviderName(): string {
        return 'ChatGPT';
    }

    getTotalCost(): number {
        const promptCost = this.totalPromptTokens * (this._promptTokensPrice / 1000000);
        const completionCost = this.totalCompletionTokens * (this._completionTokensPrice / 1000000);
        return promptCost + completionCost;
    }

    getTotalTokens(): { prompt: number; completion: number } {
        return {
            prompt: this.totalPromptTokens,
            completion: this.totalCompletionTokens
        };
    }

    async performCodeReview(diff: string, fileName: string): Promise<ReviewResult> {
        if (!diff || diff.trim().length === 0) {
            tl.warning(`[ChatGPT] Pomijam ${fileName} - brak zmian`);
            return { response: '', promptTokens: 0, completionTokens: 0 };
        }

        if (this.doesMessageExceedTokenLimit(diff + this.systemMessage, this._maxTokens)) {
            tl.warning(`[ChatGPT] Nie można przetworzyć ${fileName} - przekroczono limit tokenów`);
            return { response: '', promptTokens: 0, completionTokens: 0 };
        }

        try {
            const completion = await this._openai.chat.completions.create({
                model: this._model,
                messages: [
                    {
                        role: 'system',
                        content: this.systemMessage
                    },
                    {
                        role: 'user',
                        content: diff
                    }
                ]
            });

            const tokenUsage = completion.usage;
            console.info(`[ChatGPT] Użycie: ${JSON.stringify(tokenUsage)}`);

            if (completion.choices && completion.choices.length > 0) {
                const promptTokens = tokenUsage?.prompt_tokens || 0;
                const completionTokens = tokenUsage?.completion_tokens || 0;

                this.totalPromptTokens += promptTokens;
                this.totalCompletionTokens += completionTokens;

                return {
                    response: completion.choices[0].message.content || '',
                    promptTokens: promptTokens,
                    completionTokens: completionTokens,
                };
            }

            return { response: '', promptTokens: 0, completionTokens: 0 };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            tl.error(`[ChatGPT] Błąd dla modelu "${this._model}": ${errorMessage}`);

            if (errorMessage.includes('404') && errorMessage.includes('v1/responses')) {
                tl.error(`[ChatGPT] Model "${this._model}" może wymagać specjalnego dostępu lub być w beta.`);
                tl.error(`[ChatGPT] Sprawdź dostęp na: https://platform.openai.com/settings/organization/limits`);
                tl.error(`[ChatGPT] Wypróbuj alternatywne modele: gpt-5, gpt-5-mini, gpt-4o, gpt-4o-mini`);
            } else if (errorMessage.includes('model') || errorMessage.includes('404')) {
                tl.error(`[ChatGPT] Sprawdź nazwę modelu i dostępność na: https://platform.openai.com/docs/pricing`);
            }

            throw error;
        }
    }

    private doesMessageExceedTokenLimit(message: string, tokenLimit: number): boolean {
        const estimatedTokens = Math.ceil(message.length / 4);
        return estimatedTokens > tokenLimit;
    }
}

export class CodexProvider implements AIProvider {
    private readonly systemMessage: string;
    private totalPromptTokens: number = 0;
    private totalCompletionTokens: number = 0;

    constructor(
        private _openai: OpenAI,
        private _model: string,
        private _maxTokens: number,
        private _promptTokensPrice: number,
        private _completionTokensPrice: number,
        systemMessage: string
    ) {
        this.systemMessage = systemMessage;
    }

    getProviderName(): string {
        return 'Codex';
    }

    getTotalCost(): number {
        const promptCost = this.totalPromptTokens * (this._promptTokensPrice / 1000000);
        const completionCost = this.totalCompletionTokens * (this._completionTokensPrice / 1000000);
        return promptCost + completionCost;
    }

    getTotalTokens(): { prompt: number; completion: number } {
        return {
            prompt: this.totalPromptTokens,
            completion: this.totalCompletionTokens
        };
    }

    async performCodeReview(diff: string, fileName: string): Promise<ReviewResult> {
        if (!diff || diff.trim().length === 0) {
            tl.warning(`[Codex] Pomijam ${fileName} - brak zmian`);
            return { response: '', promptTokens: 0, completionTokens: 0 };
        }

        if (this.doesMessageExceedTokenLimit(diff + this.systemMessage, this._maxTokens)) {
            tl.warning(`[Codex] Nie można przetworzyć ${fileName} - przekroczono limit tokenów`);
            return { response: '', promptTokens: 0, completionTokens: 0 };
        }

        try {
            // Codex używa responses API zamiast chat completions
            const response = await this._openai.responses.create({
                model: this._model,
                input: `${this.systemMessage}\n\n${diff}`,
                reasoning: { effort: 'high' }
            } as any); // TypeScript może nie znać responses API

            console.info(`[Codex] Użycie: input_tokens=${response.usage?.input_tokens}, output_tokens=${response.usage?.output_tokens}`);

            if (response.output_text) {
                const promptTokens = response.usage?.input_tokens || 0;
                const completionTokens = response.usage?.output_tokens || 0;

                this.totalPromptTokens += promptTokens;
                this.totalCompletionTokens += completionTokens;

                return {
                    response: response.output_text,
                    promptTokens: promptTokens,
                    completionTokens: completionTokens,
                };
            }

            return { response: '', promptTokens: 0, completionTokens: 0 };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            tl.error(`[Codex] Błąd dla modelu "${this._model}": ${errorMessage}`);

            if (errorMessage.includes('model') || errorMessage.includes('404')) {
                tl.error(`[Codex] Sprawdź dostęp do modelu na: https://platform.openai.com/settings/organization/limits`);
                tl.error(`[Codex] Dostępne modele: gpt-5-codex, gpt-5.1-codex, gpt-5.1-codex-max`);
            }

            throw error;
        }
    }

    private doesMessageExceedTokenLimit(message: string, tokenLimit: number): boolean {
        const estimatedTokens = Math.ceil(message.length / 4);
        return estimatedTokens > tokenLimit;
    }
}

export function buildSystemMessage(
    responseLanguage: string,
    checkForBugs: boolean,
    checkForPerformance: boolean,
    checkForBestPractices: boolean,
    additionalPrompts: string[],
    numberOfFilesToReview: number
): string {
    const languageInstruction = getLanguageInstruction(responseLanguage);

    let message = `Your task is to act as a code reviewer of a Pull Request.

    ${languageInstruction}

    ${numberOfFilesToReview > 1 ? '- Generate high-level summary and a technical walkthrough of all pull request changes' : ''}
    ${checkForBugs ? '- If there are any bugs, highlight them.' : ''}
    ${checkForPerformance ? '- If there are major performance problems, highlight them.' : ''}
    ${checkForBestPractices ? '- Provide details on missed use of best-practices.' : ''}
    ${additionalPrompts.length > 0 ? additionalPrompts.map(str => `- ${str}`).join('\n') : ''}
    - Do not highlight minor issues and nitpicks.
    - Only provide instructions for improvements.
    - If you have no specific instructions for a certain topic, then do not mention the topic at all.
    - If you have no instructions for code then respond with NO_COMMENT only, otherwise provide your instructions.

    You are provided with the code changes (diffs) in a unidiff format.

    The response should be in markdown format:
    - Use bullet points if you have multiple comments. Utilize emojis to make your comments more engaging.
    - Use the code block syntax for larger code snippets but do not wrap the whole response in a code block
    - Use inline code syntax for smaller inline code snippets
`;

    if (numberOfFilesToReview > 1) {
        message += `
    Create table that lists the files and their respective comments. For example:

    Summary of changes: ...

    Feedback on files:
    | File Name | Comments |
    | --- | --- |
    | file1.cs | - comment1 |
    | file2.js | - comment2<br>- comment3 |
    | file3.py | No comments |
    | styles.css | - comment4 |
`;
    }

    return message;
}

function getLanguageInstruction(language: string): string {
    const languageMap: { [key: string]: string } = {
        'Polish': 'IMPORTANT: Respond in Polish language (Polski). All your comments and feedback must be written in Polish.',
        'English': 'IMPORTANT: Respond in English language. All your comments and feedback must be written in English.',
        'German': 'IMPORTANT: Respond in German language (Deutsch). All your comments and feedback must be written in German.',
        'French': 'IMPORTANT: Respond in French language (Français). All your comments and feedback must be written in French.',
        'Spanish': 'IMPORTANT: Respond in Spanish language (Español). All your comments and feedback must be written in Spanish.'
    };

    return languageMap[language] || languageMap['Polish'];
}
