import tl = require('azure-pipelines-task-lib/task');
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AIProvider, ClaudeProvider, OpenAIProvider, CodexProvider, buildSystemMessage, isCodexModel } from './aiProvider';
import { Repository } from './repository';
import { PullRequest } from './pullrequest';

export class Main {
    private static _providers: AIProvider[] = [];
    private static _repository: Repository;
    private static _pullRequest: PullRequest;

    public static async Main(): Promise<void> {
        if (tl.getVariable('Build.Reason') !== 'PullRequest') {
            tl.setResult(tl.TaskResult.Skipped, "This task must only be used when triggered by a Pull Request.");
            return;
        }

        if(!tl.getVariable('System.AccessToken')) {
            tl.setResult(tl.TaskResult.Failed, "'Allow Scripts to Access OAuth Token' must be enabled. See https://learn.microsoft.com/en-us/azure/devops/pipelines/build/options?view=azure-devops#allow-scripts-to-access-the-oauth-token for more information");
            return;
        }

        // Read common parameters
        const responseLanguage = tl.getInput('responseLanguage', false) ?? 'Polish';
        const fileExtensions = tl.getInput('fileExtensions', false);
        const filesToExclude = tl.getInput('fileExcludes', false);
        const additionalPrompts = tl.getInput('additionalPrompts', false)?.split(',')
        const maxTokens = parseInt(tl.getInput('maxTokens', false) ?? '16384');
        const reviewWholeDiffAtOnce = tl.getBoolInput('reviewWholeDiffAtOnce', false);
        const addCostToComments = tl.getBoolInput('addCostToComments', false);

        // Read pricing parameters
        const claudePromptPrice = parseFloat(tl.getInput('claudePromptTokensPrice', false) ?? '3.00');
        const claudeCompletionPrice = parseFloat(tl.getInput('claudeCompletionTokensPrice', false) ?? '15.00');
        const openAiPromptPrice = parseFloat(tl.getInput('openAiPromptTokensPrice', false) ?? '2.50');
        const openAiCompletionPrice = parseFloat(tl.getInput('openAiCompletionTokensPrice', false) ?? '10.00');

        // Read Claude parameters
        const claudeApiKey = tl.getInput('claudeApiKey', false);
        const claudeModel = tl.getInput('claudeModel', false);

        // Read OpenAI parameters
        const openAiApiKey = tl.getInput('openAiApiKey', false);
        const openAiModel = tl.getInput('openAiModel', false);

        this._repository = new Repository();
        this._pullRequest = new PullRequest();
        let filesToReview = await this._repository.GetChangedFiles(fileExtensions, filesToExclude);

        console.info(`Znaleziono ${filesToReview.length} plików do przeglądu: ${filesToReview.join(', ')}`);

        if (filesToReview.length === 0) {
            console.info('Brak plików do przeglądu.');
            tl.setResult(tl.TaskResult.Succeeded, "Brak plików do przeglądu.");
            return;
        }

        // Build system message
        const systemMessage = buildSystemMessage(
            responseLanguage,
            tl.getBoolInput('reviewBugs', true),
            tl.getBoolInput('reviewPerformance', true),
            tl.getBoolInput('reviewBestPractices', true),
            additionalPrompts || [],
            filesToReview.length
        );

        // Initialize providers based on configuration
        if (claudeApiKey && claudeModel) {
            console.info('Inicjalizacja Claude provider...');
            const claudeClient = new Anthropic({ apiKey: claudeApiKey });
            this._providers.push(new ClaudeProvider(
                claudeClient,
                claudeModel,
                responseLanguage,
                maxTokens,
                claudePromptPrice,
                claudeCompletionPrice,
                systemMessage
            ));
        }

        if (openAiApiKey && openAiModel) {
            const openAiClient = new OpenAI({
                apiKey: openAiApiKey
            });

            // Sprawdź czy to model Codex (używa responses API)
            if (isCodexModel(openAiModel)) {
                console.info(`Inicjalizacja Codex provider dla modelu ${openAiModel}...`);
                this._providers.push(new CodexProvider(
                    openAiClient,
                    openAiModel,
                    maxTokens,
                    openAiPromptPrice,
                    openAiCompletionPrice,
                    systemMessage
                ));
            } else {
                console.info(`Inicjalizacja OpenAI provider dla modelu ${openAiModel}...`);
                this._providers.push(new OpenAIProvider(
                    openAiClient,
                    openAiModel,
                    maxTokens,
                    openAiPromptPrice,
                    openAiCompletionPrice,
                    systemMessage
                ));
            }
        }

        if (this._providers.length === 0) {
            tl.setResult(tl.TaskResult.Failed, "Nie skonfigurowano żadnego dostawcy AI. Uzupełnij parametry dla Claude lub OpenAI.");
            return;
        }

        console.info(`Skonfigurowano ${this._providers.length} dostawców: ${this._providers.map(p => p.getProviderName()).join(', ')}`);

        await this._pullRequest.DeleteComments();

        tl.setProgress(0, 'Wykonywanie przeglądu kodu');

        if(!reviewWholeDiffAtOnce) {
            // Review each file separately with all providers
            for (let index = 0; index < filesToReview.length; index++) {
                const fileToReview = filesToReview[index];
                let diff = await this._repository.GetDiff(fileToReview);

                // Get reviews from all providers
                for (const provider of this._providers) {
                    console.info(`[${provider.getProviderName()}] Przeglądanie ${fileToReview}...`);
                    let review = await provider.performCodeReview(diff, fileToReview);

                    if(review.response && review.response.indexOf('NO_COMMENT') < 0) {
                        const commentWithProvider = `## 🤖 ${provider.getProviderName()} Review\n\n${review.response}`;
                        console.info(`[${provider.getProviderName()}] Ukończono przegląd ${fileToReview}`);
                        await this._pullRequest.AddComment(fileToReview, commentWithProvider);
                    } else {
                        console.info(`[${provider.getProviderName()}] Brak komentarzy dla ${fileToReview}`);
                    }
                }

                tl.setProgress((100 / filesToReview.length) * (index + 1), 'Wykonywanie przeglądu kodu');
            }

            // Add cost summary comment for file-by-file mode
            if(addCostToComments && this._providers.length > 0) {
                let costSummary = '## 💰 Podsumowanie kosztów\n\n';
                let totalCost = 0;

                for (const provider of this._providers) {
                    const cost = provider.getTotalCost();
                    const tokens = provider.getTotalTokens();
                    totalCost += cost;
                    costSummary += `**${provider.getProviderName()}:** $${cost.toFixed(6)} (${tokens.prompt} input + ${tokens.completion} output tokens)\n\n`;
                }

                costSummary += `**Całkowity koszt:** $${totalCost.toFixed(6)}`;
                await this._pullRequest.AddComment("", costSummary);
            }
        } else {
            // Review whole diff at once with all providers
            let fullDiff = '';
            for (const fileToReview of filesToReview) {
                let diff = await this._repository.GetDiff(fileToReview);
                fullDiff += diff;
            }

            // Get reviews from all providers for the full diff
            for (const provider of this._providers) {
                console.info(`[${provider.getProviderName()}] Przeglądanie całego diffa...`);
                let review = await provider.performCodeReview(fullDiff, 'Full Diff');

                if(review.response && review.response.indexOf('NO_COMMENT') < 0) {
                    let comment = `## 🤖 ${provider.getProviderName()} Review\n\n${review.response}`;

                    // Add cost info for this provider
                    if(addCostToComments) {
                        const cost = provider.getTotalCost();
                        const tokens = provider.getTotalTokens();
                        comment += `\n\n💰 _Koszt: $${cost.toFixed(6)} (${tokens.prompt} input + ${tokens.completion} output tokens)_`;
                    }

                    await this._pullRequest.AddComment("", comment);
                    console.info(`[${provider.getProviderName()}] Ukończono przegląd dla ${filesToReview.length} plików`);
                } else {
                    console.info(`[${provider.getProviderName()}] Brak komentarzy dla całego diffa`);
                }
            }
        }

        // Cost analysis logging
        if(this._providers.length > 0) {
            console.info(`\n--- 💰 Analiza kosztów ---`);
            let totalCost = 0;

            for (const provider of this._providers) {
                const cost = provider.getTotalCost();
                const tokens = provider.getTotalTokens();
                totalCost += cost;

                console.info(`\n[${provider.getProviderName()}]`);
                console.info(`  🪙 Input Tokens  : ${tokens.prompt}`);
                console.info(`  🪙 Output Tokens : ${tokens.completion}`);
                console.info(`  💵 Koszt         : $${cost.toFixed(6)}`);
            }

            if(this._providers.length > 1) {
                console.info(`\n💰 Całkowity koszt: $${totalCost.toFixed(6)}`);
            }
        }

        tl.setResult(tl.TaskResult.Succeeded, "Przegląd Pull Request zakończony.");
    }
}

Main.Main();