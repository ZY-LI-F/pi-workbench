"""Exercise the actual Paper2Any editable-slide service and upstream exporter.

Calls are sequential library operations, not delegated autonomous agents.
Upstream fallback output is preserved but explicitly fails this acceptance test.
"""
from __future__ import annotations
import asyncio
import json
import os
from pathlib import Path
import subprocess
import time
import zipfile

ROOT = Path(__file__).resolve().parent
REPO = Path(os.environ.get('PAPER2ANY_REPO', 'C:/Users/qq108/AppData/Local/Temp/stella-paper2any-20260918'))
NODE = Path('C:/Users/qq108/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')
NODE_MODULES = NODE.parent.parent/'node_modules'
TSX = ROOT.parents[1]/'node_modules/tsx/dist/cli.mjs'
OUT = ROOT/'gui-test/paper2any/frontend'


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


async def main():
    key = os.environ['DEEPSEEK_API_KEY']
    os.environ.update(DF_API_URL='https://api.deepseek.com', DF_MODEL='deepseek-flash', DF_API_KEY=key)
    if (OUT/'result.json').exists():
        raise FileExistsError('A completed frontend attempt already exists; preserve its evidence')
    outline_path = ROOT/'gui-test/paper2any/outline-refined.json'
    pages = json.loads(outline_path.read_text(encoding='utf-8'))
    if not isinstance(pages, list) or len(pages) != 10:
        raise ValueError('Requires the ten-page real upstream refined outline')
    import httpx
    from fastapi_app.schemas import FrontendPPTGenerationRequest
    from fastapi_app.services.paper2ppt_frontend_service import Paper2PPTFrontendService

    # Observe real provider receipts without modifying requests or responses.
    native_post = httpx.AsyncClient.post
    receipts = []
    async def observed_post(self, url, *args, **kwargs):
        response = await native_post(self, url, *args, **kwargs)
        request_json = kwargs.get('json') or {}
        record = {'requested_model':request_json.get('model'), 'status':response.status_code,
                  'requested_max_tokens':request_json.get('max_tokens')}
        if response.status_code == 200:
            data = response.json()
            choices = data.get('choices') or []
            record.update(response_model=data.get('model'), usage=data.get('usage'),
                          finish_reason=choices[0].get('finish_reason') if choices else None)
        receipts.append(record)
        save('api-receipts.json', receipts)
        return response
    httpx.AsyncClient.post = observed_post
    # Upstream enforces its own outputs root; keep that boundary intact.
    work = REPO/'outputs/stella-moleculenet-20260918'
    if work.exists():
        raise FileExistsError(f'Refusing to reuse a prior native service run: {work}')
    work.mkdir(parents=True)
    service = Paper2PPTFrontendService()
    slides, theme, failures = [], None, []
    started = time.perf_counter()
    try:
        for index in range(len(pages)):
            req = FrontendPPTGenerationRequest(
                chat_api_url='https://api.deepseek.com', api_key=key,
                credential_scope='paper2ppt', model='deepseek-flash',
                language='zh', style='学术研究报告，简洁排版，保留提供的数字与限制，中文字体使用 Noto Sans SC。',
                result_path=str(work), pagecontent=json.dumps(pages, ensure_ascii=False),
                include_images=False, image_mode='none', page_id=index)
            response = await service.generate_slides(req, request=None)
            actual = response.get('slides') or []
            if not response.get('success') or len(actual) != 1:
                raise RuntimeError(f'Native slide {index+1} response is incomplete')
            slide = actual[0]
            raw_path = work/'frontend_slide_specs'/f'page_{index:03d}.raw_ai.json'
            raw = json.loads(raw_path.read_text(encoding='utf-8'))
            if raw.get('fallback') or raw.get('error') or 'fallback' in str(slide.get('generation_note','')).lower():
                failures.append({'page':index+1, 'reason':'native service used fallback',
                                 'detail':str(slide.get('generation_note','')).replace(key,'[REDACTED]')})
            slides.append(slide)
            theme = response.get('theme')
            save(f'page-{index+1:02d}.raw.json', raw)
            save('slides.json', slides)
            save('theme.json', theme)
            print(json.dumps({'page':index+1, 'fallback':bool(raw.get('fallback')), 'complete':len(slides)}), flush=True)
        for i, record in enumerate(receipts):
            if record['status'] != 200 or record.get('finish_reason') == 'length':
                failures.append({'call':i+1, 'reason':'provider error or truncated output', 'receipt':record})
        if len(receipts) != 11:
            failures.append({'reason':'Expected one theme request and ten actual slide requests', 'count':len(receipts)})
        if failures:
            save('result.json', {'status':'failed', 'stage':'native frontend generation', 'failures':failures,
                                'pages':len(slides), 'seconds':time.perf_counter()-started,
                                'exported':False, 'note':'Fallback templates are not a passing model generation.'})
            raise RuntimeError('Native frontend acceptance failed; see saved failure evidence')
        target = OUT/'Paper2Any-native-editable.pptx'
        command = [str(NODE), str(TSX),
                   str(REPO/'frontend-workflow/scripts/run_paper2ppt_structured_export_cli.ts'),
                   '--slides-json',str(OUT/'slides.json'),'--theme-json',str(OUT/'theme.json'),
                   '--output',str(target)]
        subprocess.run(command, cwd=REPO/'frontend-workflow', check=True)
        with zipfile.ZipFile(target) as archive:
            pages_in_file = [n for n in archive.namelist() if n.startswith('ppt/slides/slide') and n.endswith('.xml')]
            if len(pages_in_file) != 10 or archive.testzip() is not None:
                raise RuntimeError('Native PPTX file failed structural checks')
        save('result.json', {'status':'generated_requires_visual_review', 'stage':'native editable frontend/export',
                            'model':'deepseek-flash', 'pages':len(slides), 'api_calls':len(receipts),
                            'seconds':time.perf_counter()-started, 'exported':True, 'pptx':str(target),
                            'scope':'Real upstream service and PptxGenJS CLI; text-only mode, no Web UI or image models.'})
    except Exception as error:
        if not (OUT/'result.json').exists():
            save('result.json', {'status':'failed', 'stage':'native frontend/export', 'pages':len(slides),
                                'error_type':type(error).__name__, 'detail':str(error).replace(key,'[REDACTED]'),
                                'seconds':time.perf_counter()-started, 'exported':False})
        raise


if __name__ == '__main__':
    asyncio.run(main())
