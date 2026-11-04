---
name: super-prompt-maker
description: "Write or improve prompts for another AI, tuned to the target service: ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek, Microsoft Copilot, HyperCLOVA X or image generators like Midjourney. Three variants for one service, or one each for up to four. Use whenever the user wants a prompt made, polished or adapted for an AI (프롬프트 만들어줘, 프롬프트 다듬어줘, ChatGPT용 프롬프트, 미드저니 프롬프트), not when they want the task itself done."
---

# Super Prompt Maker

Writes prompts that another AI will receive, never the answer to them. This is the agent version of
the Super Prompt Maker web service and uses the same per-service guides and rules.

## Steps

1. **Read the request.** From the conversation, work out:
   - the material: a draft prompt to strengthen, or a description of the prompt they want;
   - the target services, up to 4, as ids from the table below. If none is named, use `universal`,
     or the obvious one (a request for a picture means `midjourney`);
   - the prompt language: `ko` by default, `en` when the user writes in English or asks for English
     prompts. Image prompts are always written in English;
   - the purpose, optional: `general` (default), `accuracy`, `creative`, `structure`, `coding`,
     `business`, `learning` or `research`.

   If there is no material at all ("make me a prompt"), ask what the prompt is for before going on.

2. **Get the brief.** Run the script in this skill's folder (the folder that holds this SKILL.md),
   with ids only:

   ```bash
   node "<skill folder>/scripts/spm.mjs" brief --target claude --target chatgpt --lang ko --purpose general
   ```

   Keep the user's text off the command line. The brief refers to the conversation instead, so their
   text never passes through a shell, where quoting and console encoding can mangle it.

3. **Follow the brief** and answer in the Markdown shape it ends with: a heading, the prompt in a
   `text` code block and a why line for every prompt, so the user can compare them side by side. One
   target gets three variants (quick, structured, deep), even for "a prompt", unless the user asked for
   a number; two to four targets get one structured prompt each.

4. **Stop there.** Don't run the prompts or do the task yourself. When the user wants changes,
   revise the prompts directly; get a new brief only when the targets change.

## Target ids

| id | Service |
|---|---|
| `chatgpt` | ChatGPT (OpenAI) |
| `claude` | Claude (Anthropic) |
| `gemini` | Gemini (Google) |
| `perplexity` | Perplexity |
| `grok` | Grok (xAI) |
| `deepseek` | DeepSeek |
| `copilot` | Microsoft Copilot |
| `clova` | HyperCLOVA X (NAVER) |
| `midjourney` | Image generators (Midjourney, DALL·E, Stable Diffusion, …) |
| `universal` | Any AI |

## If the script can't run

The script needs Node.js 18 or later. If `node` is missing or the script fails, tell the user, then
write the prompts anyway (a `###` heading per prompt, the prompt in a `text` code block, one line on
why it works), following each service's conventions: XML tags
for Claude, Markdown sections for ChatGPT, Persona-Task-Context-Format for Gemini, one precise search
question for Perplexity, and a single English description for image models.
