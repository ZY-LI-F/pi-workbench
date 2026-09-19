"""Real upstream Paper2Any text-outline/refinement test; no parallel agents or fake LLM."""
from __future__ import annotations
import asyncio
import argparse
import hashlib
import json
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parent
REPO = Path(os.environ.get('PAPER2ANY_REPO', 'C:/Users/qq108/AppData/Local/Temp/stella-paper2any-20260918'))

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

def validate_outline(pages, expected):
    if not isinstance(pages, list) or len(pages) != expected:
        raise ValueError(f'Expected {expected} real output pages, found {len(pages) if isinstance(pages,list) else type(pages)}')
    for p in pages:
        if not isinstance(p, dict):
            raise ValueError('Outline page must be a structured object')
        if not all(isinstance(p.get(k), str) and p[k].strip() for k in ['title','layout_description']):
            raise ValueError('Title or layout missing from real output')
        if not isinstance(p.get('key_points'), list) or not p['key_points'] or not all(isinstance(k, str) and k.strip() for k in p['key_points']):
            raise ValueError('Outline key points violate upstream schema')
        if p.get('asset_ref') is not None:
            raise ValueError('Model invented an image reference despite empty catalog')

async def main(output=None):
    # The GUI process receives this from existing Pi credential storage, never a source file.
    key = os.environ['DEEPSEEK_API_KEY']
    os.environ['DF_API_URL'] = 'https://api.deepseek.com'
    os.environ['DF_MODEL'] = 'deepseek-flash'
    os.environ['DF_API_KEY'] = key
    # Verify the documented privacy patches before giving the upstream library a live credential.
    for name in ['dataflow_agent/llm_callers/text.py', 'dataflow_agent/agentroles/cores/base_agent.py']:
        src = (REPO / name).read_text(encoding='utf-8')
        if 'api_key={self.state.request.api_key}' in src or 'API Key: {state.request.api_key}' in src:
            raise RuntimeError('Upstream plaintext-key log is not patched')
    from dataflow_agent.agentroles.paper2any_agents.outline_agent import outline_agent
    from dataflow_agent.agentroles.paper2any_agents.outline_refine_agent import outline_refine_agent
    from dataflow_agent.state import Paper2FigureRequest, Paper2FigureState
    from dataflow_agent.toolkits.tool_manager import ToolManager
    from langchain_openai import ChatOpenAI
    # Observe the real upstream response without replacing its implementation.
    # Persist only allowlisted metadata, never prompts, authorization or headers.
    api_calls = []
    out = Path(output) if output else ROOT/'gui-test/paper2any'
    if (out/'result.json').exists():
        raise FileExistsError('Do not overwrite an already completed test')
    native_call = ChatOpenAI.ainvoke
    async def observed_call(self, *args, **kwargs):
        response = await native_call(self, *args, **kwargs)
        meta = response.response_metadata or {}
        api_calls.append({'requested_model':self.model_name,
                          'response_model':meta.get('model_name'),
                          'finish_reason':meta.get('finish_reason'),
                          'token_usage':meta.get('token_usage'),
                          'usage_metadata':response.usage_metadata})
        save(out/'api-receipts.json', api_calls)
        if meta.get('finish_reason') == 'length':
            raise RuntimeError('Upstream response truncated at model limit')
        return response
    # simple mode uses create_llm().ainvoke directly, bypassing TextLLMCaller.
    ChatOpenAI.ainvoke = observed_call
    evidence = (ROOT/'gui-test/paper2agent/moleculenet-paper/references/paper.md').read_text(encoding='utf-8')
    report = ROOT/'verification/summary.json'
    verified = json.loads(report.read_text(encoding='utf-8'))
    if verified.get('status') != 'verified' or verified.get('total_runs') != 48:
        raise RuntimeError('All 48 independently verified runs are required before testing result-based outlines')
    evidence += '\n\n# 本次真实实验（不是论文原始数值）\n'+report.read_text(encoding='utf-8')
    evidence += '\n\n任务边界：仅生成论文说明大纲，不要声称完成全部17个数据集复现；只陈述给定证据中的结果。'
    manager = ToolManager()
    req = Paper2FigureRequest(language='zh', chat_api_url='https://api.deepseek.com',
        api_key=key, chat_api_key=key, model='deepseek-flash', page_count=10)
    state = Paper2FigureState(request=req)
    started = time.perf_counter()
    state = await outline_agent(state, model_name='deepseek-flash', tool_manager=manager,
        use_agent=False, react_mode=False, use_vlm=False, text_content=evidence,
        minueru_output='', paper_visual_catalog='', max_tokens=12000)
    original = state.pagecontent
    save(out/'outline-original.json', original)
    validate_outline(original, 10)
    outline_seconds = time.perf_counter() - started
    started_refine = time.perf_counter()
    state = await outline_refine_agent(state, model_name='deepseek-flash', tool_manager=manager,
        use_agent=False, react_mode=False, use_vlm=False, text_content=evidence,
        minueru_output='', pagecontent=json.dumps(original, ensure_ascii=False),
        pagecontent_raw=original, max_tokens=12000,
        outline_feedback='保留10页及顺序。明确区分论文原始基准和本次局部现代环境复现；必须说明随机80/10/10、RMSE越低越好、三个种子、无超参数搜索、不能认定临床有效。科学英文缩写可保留。不得新增未经提供的实验数字。')
    refined = state.pagecontent
    save(out/'outline-refined.json', refined)
    validate_outline(refined, 10)
    if refined == original:
        raise ValueError('Refinement did not change the output; possible upstream fallback, not a passing test')
    if len(api_calls) != 2 or any(c.get('response_model') != 'deepseek-flash' or c.get('finish_reason') != 'stop' for c in api_calls):
        raise ValueError('Requires two observed, completed DeepSeek Flash API responses')
    result = {'status':'passed', 'model':'deepseek-flash', 'resolved_model_name':'DeepSeek V4.1 Flash',
        'upstream_commit':'b538531e25798d9b9d41afd5fa93c9222949b5a5',
        'stages':['upstream outline_agent simple mode','upstream outline_refine_agent simple mode'],
        'pages':len(refined),'outline_seconds':outline_seconds,'refine_seconds':time.perf_counter()-started_refine,
        'api_calls':api_calls,
        'source_sha256':hashlib.sha256(evidence.encode()).hexdigest(),
        'limits':['Component-level real API test; not the complete Paper2Any web app or multimodal pipeline',
                  'No image model or MinerU/SAM service used; input is reviewed text extracted by Paper2Agent',
                  'Sequential library calls, no autonomous subagent orchestration',
                  'Schema success does not certify scientific accuracy; main-agent content review required'],
        'privacy_patches':['redacted API key in text.py and base_agent.py logs']}
    save(out/'result.json', result)
    lines=['# Paper2Any 实测大纲','', '模型：DeepSeek V4.1 Flash。上游文本生成/修订流程的实际输出，未视作实验结果。','']
    for i,p in enumerate(refined,1):
        lines += [f'## {i}. {p["title"]}','',p['layout_description'],'']+[f'- {s}' for s in p['key_points']]+['']
    (out/'outline.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    asyncio.run(main(parser.parse_args().output))
