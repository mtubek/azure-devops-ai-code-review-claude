# AI Code Review DevOps Extension


## Supercharge Your Code Reviews with Claude AI

Use Anthropic's Claude AI to provide intelligent pull request code reviews.

- **AI Powered Insights:** Leverages Claude's advanced language models (Claude 3.5 Sonnet, Opus, etc.) for high-quality code analysis
- **Security and Privacy:** Uses Anthropic's Claude API with your own API key
- **Automated Summaries:** Let Claude summarize your pull request so it's easier for humans to follow. Claude will also provide feedback for all changes related to bugs, performance, best practices etc.
- **Easy to install:** A simple one-click installation from the [Azure DevOps Marketplace]([https://marketplace.visualstudio.com/azuredevops](https://marketplace.visualstudio.com/items?itemName=TommiLaukkanen.ai-code-review)) gets you up and running instantly. Configure to your pipeline as shown below.
- **Faster Reviews:** Reduce the time spent on code reviews. Let Claude handle the routine, allowing your team to focus on impactful work.
- **Configurable and Customizable:** Tailor the extension to your needs with customizable settings. Specify the Claude model, define file exclusions, and more.

![](images/ai-review-buddy-640.png)

## Sample review

Click for larger version:

[![sample review](screenshots/review1-thumbnail.jpg)](screenshots/review1.jpg)

## What does it cost?

The extension itself is free. The reviews will utilize Anthropic's Claude API with your own API key. As of February 2025, Claude 3.5 Sonnet pricing is $3.00 per 1M input tokens and $15.00 per 1M output tokens. For smaller models like Claude 3.5 Haiku, it's $0.80 per 1M input tokens and $4.00 per 1M output tokens. While completing many pull requests, the price per code review typically ranges from ~$0.001 to ~$0.01 per review - so if you have 1000 PRs per month it's still a [price of coffee](https://www.buymeacoffee.com/tlaukkanen) 😉

You can set the token pricing on the task parameters and then you can see from your logs how much each of the reviews cost:

![](images/cost-analysis.jpg)

## Prerequisites

- [Azure DevOps Account](https://dev.azure.com/)
- Anthropic Claude API key (get one at [console.anthropic.com](https://console.anthropic.com/))
- Optional: Pricing for input and output tokens (check from [Claude Pricing](https://www.anthropic.com/pricing#anthropic-api))

## Getting started

1. Install the AI Code Review DevOps Extension from the Azure DevOps Marketplace.
2. Get your Claude API key from [console.anthropic.com](https://console.anthropic.com/)
3. Add the API key as a secret variable in your Azure DevOps pipeline
4. Add Claude Code Review Task to Your Pipeline:

  ```yaml
  trigger:
    branches:
      exclude:
        - '*'

  pr:
    branches:
      include:
        - '*'

  jobs:
  - job: CodeReview
    pool:
      vmImage: 'ubuntu-latest'
    steps:
    - task: AICodeReview@1
      inputs:
        claudeApiKey: $(ClaudeApiKey)
        claudeModel: "claude-3-5-sonnet-20241022"
        promptTokensPricePerMillionTokens: "3.00"
        completionTokensPricePerMillionTokens: "15.00"
        addCostToComments: true
        reviewBugs: true
        reviewPerformance: true
        reviewBestPractices: true
        reviewWholeDiffAtOnce: true
        maxTokens: 16384
        fileExtensions: '.js,.ts,.css,.html,.py,.tf'
        fileExcludes: 'file1.js,file2.py,secret.txt'
        additionalPrompts: |
          Fix variable naming, Ensure consistent indentation, Review error handling approach, Check for OWASP best practices
  ```

3. If you do not already have Build Validation configured for your branch already add [Build validation](https://learn.microsoft.com/en-us/azure/devops/repos/git/branch-policies?view=azure-devops&tabs=browser#build-validation) to your branch policy to trigger the code review when a Pull Request is created

## FAQ

### Q: What agent job settings are required?

A: Ensure that "Allow scripts to access OAuth token" is enabled as part of the agent job. Follow the [documentation](https://learn.microsoft.com/en-us/azure/devops/pipelines/build/options?view=azure-devops#allow-scripts-to-access-the-oauth-token) for more details.

### Q: What permissions are required for Build Administrators?

A: Build Administrators must be given "Contribute to pull requests" access. Check [this Stack Overflow answer](https://stackoverflow.com/a/57985733) for guidance on setting up permissions.

### Bug Reports

If you find a bug or unexpected behavior, please [open a bug report](https://github.com/tlaukkanen/azure-devops-ai-code-review/issues/new?assignees=&labels=bug&template=bug_report.md&title=).

### Feature Requests

If you have ideas for new features or enhancements, please [submit a feature request](https://github.com/tlaukkanen/azure-devops-ai-code-review/issues/new?assignees=&labels=enhancement&template=feature_request.md&title=).

## License

This project is licensed under the [MIT License](LICENSE).

If you would like to contribute to the development of this extension, please follow our contribution guidelines.

