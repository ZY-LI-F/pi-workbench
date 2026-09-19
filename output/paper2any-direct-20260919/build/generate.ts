import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const buildDir = path.dirname(fileURLToPath(import.meta.url));
const taskDir = path.dirname(buildDir);
const evidenceDir = path.resolve(taskDir, '../moleculenet-reproduction-20260918');
const sourceDir = 'C:/Users/qq108/AppData/Local/Temp/stella-paper2any-20260918';
const sourcePath = path.join(sourceDir, 'frontend-workflow/src/components/paper2ppt/canvasPptxExporter.ts');
const exporter = await import(pathToFileURL(sourcePath).href);
const summaryPath = path.join(evidenceDir, 'verification/summary.json');
const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
if (summary.status !== 'verified' || summary.total_runs !== 48) throw new Error('Unexpected evidence status');

const W = 1600, H = 900, TOTAL = 14;
const FONT = 'Noto Sans SC';
const C = { bg:'#F7F8F4', panel:'#FFFFFF', primary:'#176B53', secondary:'#296B63', accent:'#A64D27', text:'#18362F', muted:'#566C63' };
const theme = {
  palette: C,
  typography: {titleFontStack:FONT, bodyFontStack:FONT, eyebrowSize:24, titleSize:62, summarySize:40, bodySize:36},
};
const slides: any[] = [];
const records: any[] = [];
const dataSources = {
  paper:'Wu et al. MoleculeNet: a benchmark for molecular machine learning. Chemical Science 9, 513–530 (2018). DOI: 10.1039/C7SC02664A. https://pubmed.ncbi.nlm.nih.gov/29629118/',
  table:'MoleculeNet author manuscript arXiv:1703.00564v3, Table 8, p.51. https://arxiv.org/abs/1703.00564v3',
  audit: 'Local evidence: ../moleculenet-reproduction-20260918/verification/summary.json; runs.json; diagnostics.json. Experiments completed 2026-09-18. Numerical computation by DeepChem on CPU.',
};
function run(dataset:string, model:string, split='random') {
  const row=summary.aggregate.find((r:any)=>r.dataset===dataset && r.model===model && r.split===split);
  if(!row || row.n_runs!==3) throw new Error(`Missing audited result: ${dataset}/${model}/${split}`);
  return row;
}
const metric=(r:any)=>`${r.test_rmse_mean.toFixed(3)} ± ${r.test_rmse_sample_sd.toFixed(3)}`;
const paperMetric=(r:any)=>r.paper_test_rmse ? `${r.paper_test_rmse[0].toFixed(3)} ± ${r.paper_test_rmse[1].toFixed(3)}` : '未列此基线';
const modelNames:Record<string,string> = {mean:'训练均值基线',rf:'RF / ECFP4',krr:'KRR / ECFP4',gc:'GraphConv'};
const models=['mean','rf','krr','gc'];

function newSlide(title:string, source:string, notes:string, dark=false) {
  const num=slides.length+1;
  const palette=dark ? {...C,bg:'#123D32',panel:'#123D32',text:'#F8FAF5',primary:'#BFE6CF',muted:'#C0D1C7',accent:'#F1C7A8'} : C;
  const s:any={slideId:`moleculenet-${num}`,pageNum:num,title,
    schemaVersion:'ppt_canvas_schema_v1',renderEngine:'canvas',blocks:[],layoutFamily:'editorial',
    root:{type:'container',id:'root',style:{padding:0,direction:'column'},children:[]},
    content:{},visualSpec:{palette,typography:theme.typography,nodeStyles:{}},
    layoutIr:{schemaVersion:'ppt_canvas_layout_ir_v1',slideId:`moleculenet-${num}`,viewport:{width:W,height:H,scale:1},nodes:[{nodeId:'root',type:'container',box:{x:0,y:0,w:W,h:H},computedStyle:{backgroundColor:'transparent'}}],overflowIssues:[]},
    htmlTemplate:'',cssCode:'',editableFields:[],visualAssets:[],status:'done',
    generationNote:'Content and Canvas structure authored directly by current Codex; native Paper2Any Canvas exporter; no Pi and no external model API.',
  };
  slides.push(s);
  records.push({page:num,title,notes,sources:source,blocks:[]});
  if(num!==1) text(s,'title',title,[76,48,1446,116],62,palette.text,true);
  text(s,'source',source.split('\n')[0],[80,814,1310,48],21,palette.muted);
  text(s,'page',`${String(num).padStart(2,'0')} / ${TOTAL}`,[1424,814,100,48],21,palette.muted,false,'right');
  return s;
}
function node(s:any,id:string,component:string,props:any,box:number[],style:any={}) {
  if(s.root.children.some((n:any)=>n.id===id))throw new Error(`Duplicate node ${id}`);
  s.root.children.push({type:'component',id,component,props});
  s.layoutIr.nodes.push({nodeId:id,type:'component',component,
    box:{x:box[0],y:box[1],w:box[2],h:box[3]},computedStyle:{
      fontFamily:FONT,fontSize:'36px',lineHeight:'48px',fontWeight:'400',
      color:s.visualSpec.palette.text,textAlign:'left',verticalAlign:'top',
      paddingTop:'0px',paddingBottom:'0px',paddingLeft:'0px',paddingRight:'0px',...style,
    }});
}
function text(s:any,id:string,value:string,box:number[],size=36,color=s.visualSpec.palette.text,bold=false,align='left') {
  s.content[id]=value;
  node(s,id,id==='title'?'heading':'text',{text_ref:id},box,{fontSize:`${size}px`,lineHeight:`${Math.ceil(size*1.3)}px`,fontWeight:bold?'700':'400',color,textAlign:align});
  s.editableFields.push({key:id,label:id,type:'textarea',value,items:[]});
  if(!['source','page','title'].includes(id)) records.at(-1).blocks.push(value);
}
function table(s:any,id:string,headers:string[],rows:string[][],box:number[]) {
  if(rows.some(r=>r.length!==headers.length))throw new Error(`Uneven table ${id}`);
  s.content[id]={headers,rows};
  node(s,id,'table',{table_ref:id},box);
  records.at(-1).blocks.push({headers,rows});
}
async function figure(s:any,id:string,name:string,available:number[],alt:string) {
  const filename=`${id}-${name}`;
  const source=path.join(evidenceDir,'gui-test/paper2agent/moleculenet-paper/assets/figure',name);
  const buffer=await fs.readFile(source);
  const {width,height}=await sharp(buffer).metadata();
  if(!width||!height)throw new Error(`Invalid source image ${name}`);
  const scale=Math.min(available[2]/width,available[3]/height);
  const w=width*scale,h=height*scale;
  const box=[available[0]+(available[2]-w)/2,available[1]+(available[3]-h)/2,w,h];
  // Match the native export box to the original aspect ratio. No redraw/crop.
  s.visualAssets.push({key:id,label:alt,alt,sourceType:'paper_asset',src:`data:image/jpeg;base64,${buffer.toString('base64')}`});
  node(s,id,'figure',{asset_ref:id},box);
  await fs.copyFile(source,path.join(taskDir,'assets',filename));
  records.at(-1).blocks.push({image:`../assets/${filename}`,alt});
}

await fs.mkdir(path.join(taskDir,'assets'),{recursive:true});
await fs.mkdir(path.join(taskDir,'deliverables'),{recursive:true});

let s=newSlide('MoleculeNet 分子性质预测局部复现',
  'Wu et al., Chemical Science, 2018     本地实验：2026-09-18',
  `本报告介绍 MoleculeNet 的三个理化性质基准，以及现代软件环境下完成的局部复现实验。已有实验包含三个数据集、四个模型和三个随机种子，再加一个骨架划分诊断，共四十八次训练与评估。这里的重点是哪些结论有实际数据支持，以及哪些差异仍未解释。这不等于完整复现论文的十七个数据集，也不构成湿实验或药物有效性证据。\n\n来源：${dataSources.paper}\n${dataSources.audit}`,true);
text(s,'name','MoleculeNet',[84,204,1420,140],98,s.visualSpec.palette.text,true);
text(s,'subtitle','分子性质预测的局部复现',[86,374,1430,104],60,s.visualSpec.palette.primary,true);
text(s,'scope','3 个完整数据集，48 次训练与评估',[88,525,1360,74],38);
text(s,'boundary','现代环境下的基准重跑与方法审计',[88,640,1360,74],34,s.visualSpec.palette.muted);

s=newSlide('本次复现聚焦三个理化性质数据集',
  '原图：Wu et al., Fig.2，CC BY-NC 3.0。保留原图，未裁切或改绘。',
  `MoleculeNet 将分子机器学习任务划分为量子力学、物理化学、生物物理和生理学等层面，原论文汇集十七个数据集。本次只选取图中物理化学部分的 ESOL、FreeSolv 和 Lipophilicity。三个集合都使用完整数据，而不是小样本演示，但其他十四个集合和论文中的其他算法没有运行。范围上的完整与局部需要同时说明。\n\n来源：${dataSources.paper}\n原图：arXiv v3 Fig.2, p.7. https://arxiv.org/abs/1703.00564v3 。Wu et al.，CC BY-NC 3.0。`,false);
text(s,'lead','论文覆盖 17 个数据集；本次运行其中 3 个完整集合',[80,182,1432,88],37,C.primary,true);
await figure(s,'scope-figure','figure-p0007-003.jpg',[78,300,1440,414],'MoleculeNet 原论文图2：量子力学、物理化学、生物物理、生理学四类任务');
text(s,'note','数值复现不涉及靶点验证、分子设计或临床疗效',[80,734,1400,56],29,C.muted);

s=newSlide('三个基准使用不同目标与单位',
  '来源：原始数据文件及 verification/summary.json。各任务 RMSE 不跨单位合并。',
  `ESOL 有一千一百二十八条记录，预测水溶解度的对数。FreeSolv 有六百四十二条记录，目标是以每摩尔千卡表示的溶剂化自由能。Lipophilicity 有四千二百条记录，预测 logD。这些目标的尺度不同，因此不能把三组误差平均成一个总分。每个数据集只应在自己的单位和相同划分条件下比较模型。\n\n来源：${dataSources.audit}\n${dataSources.paper}`);
table(s,'datasets',['数据集','记录数','预测目标','报告单位'],[
  ['ESOL',String(summary.datasets.esol.n),'水溶解度','log10(mol/L)'],
  ['FreeSolv',String(summary.datasets.freesolv.n),'溶剂化自由能','kcal/mol'],
  ['Lipophilicity',String(summary.datasets.lipophilicity.n),'脂溶性','logD'],
],[80,234,1440,328]);
text(s,'count','36 次主实验 + 12 次 ESOL 骨架划分诊断 = 48 次',[80,626,1436,84],38,C.primary,true);
text(s,'count-note','主实验：3 数据集 × 4 模型 × 3 种子',[80,724,1410,56],29,C.muted);

s=newSlide('模型比较采用预先固定的实验协议',
  '来源：experiment.json、benchmark.py。未执行原论文的超参数搜索。',
  `四个模型包括训练均值基线、随机森林、核岭回归和图卷积网络。随机森林和核岭回归使用相同的 ECFP4 特征，图模型使用原子特征。参数在结果出现前固定，图模型取第一百个 epoch，不按测试集效果选点。软件环境为 DeepChem 2.8 与 TensorFlow 2.15.1，因此这是一套公开记录的现代重跑协议，而不是原论文执行环境的完全还原。\n\n来源：${dataSources.audit}\n../moleculenet-reproduction-20260918/experiment.json, benchmark.py`);
table(s,'models',['模型','特征','固定设置'],[
 ['均值基线','不使用分子特征','预测训练集目标均值'],
 ['RF','ECFP4','500 棵树'],
 ['KRR','ECFP4','RBF；alpha 0.001；gamma 1/1024'],
 ['GraphConv','75 维原子特征','卷积 128/128；100 epochs'],
],[80,218,1440,358]);
text(s,'protocol','随机 80/10/10；种子 123、456、789',[80,632,1430,68],37,C.primary,true);
text(s,'training','仅训练集拟合标准化；GraphConv 固定最后一个 epoch',[80,719,1430,70],30,C.muted);

s=newSlide('随机划分与骨架划分回答不同问题',
  '原图：Wu et al., Fig.3，CC BY-NC 3.0。右侧为本次实验协议。',
  `原图对比了四种数据划分方式。本次主实验采用随机划分，并只对 ESOL 增加骨架划分诊断。骨架划分让共享骨架的分子保持在同一分区，从而检验更困难的结构外推。需要特别注意，所用 DeepChem ScaffoldSplitter 是确定性的，三次运行使用同一个骨架分区，改变的是学习器随机性，不是三折交叉验证。\n\n来源：${dataSources.paper}\n原图：arXiv v3 Fig.3, p.13，CC BY-NC 3.0。\n${dataSources.audit}`);
await figure(s,'split-figure','figure-p0013-000.jpg',[82,181,620,600],'MoleculeNet 原论文图3：随机、骨架、分层、时间四类划分方法');
text(s,'random-title','主实验：随机划分',[794,230,700,65],42,C.primary,true);
text(s,'random-body','三个数据集均采用 80/10/10\n不同种子产生不同随机分区',[794,315,700,134],35);
text(s,'scaffold-title','诊断：ESOL 骨架划分',[794,498,700,65],42,C.primary,true);
text(s,'scaffold-body','三个种子共享同一骨架分区\n仅学习器随机性改变\n不等同于三折交叉验证',[794,588,700,178],34);

function resultsSlide(dataset:string,title:string,interpretation:string,notes:string) {
  const unit=summary.datasets[dataset].unit;
  const slide=newSlide(title,`测试 RMSE（${unit}），越低越好。本次均值 ± 样本 SD，n=3。论文：Table 8。`,
    `${notes}\n\n本次标准差使用 ddof=1。论文标准差的具体口径未独立恢复。不同超参数与分区下的比较仅为描述性比较，不代表统计显著性或算法因果优劣。\n\n来源：${dataSources.table}\n${dataSources.audit}`);
  text(slide,'units',`${dataset==='lipophilicity'?'Lipophilicity':dataset==='esol'?'ESOL':'FreeSolv'}   测试 RMSE / ${unit}`,[80,178,1430,60],33,C.muted);
  table(slide,'results',['模型','本次实验','原论文'],models.map(model=>{
    const r=run(dataset,model); return [modelNames[model],metric(r),paperMetric(r)];
  }),[80,266,1440,342]);
  text(slide,'interpretation',interpretation,[80,652,1430,118],38,dataset==='freesolv'?C.accent:C.primary,true);
  return slide;
}
resultsSlide('esol','ESOL 上 GraphConv 的平均误差最低',
  '本次 GraphConv 为 1.046，论文为 0.970\n不同划分与训练条件下，不作显著性判断',
  '先看 ESOL。三个学习模型都优于训练均值基线，GraphConv 的平均测试误差最低。其均值为一点零四六，而论文同模型为零点九七。两者在量级上接近，但运行次数只有三次，训练条件也不一致，不能直接据此断言复现了相同性能。随机划分中的重复结构交叉还会限制对新结构的外推解释。');
resultsSlide('freesolv','FreeSolv 未重现 GraphConv 的优势',
  `本次 GraphConv 误差较论文均值高 ${((run('freesolv','gc').test_rmse_mean/1.4-1)*100).toFixed(1)}%\n其均值也高于本次 RF 与 KRR`,
  'FreeSolv 是本轮必须保留的负结果。原论文中 GraphConv 的测试误差为一点四，而本次为二点一五一，较论文均值高百分之五十三点七。本次 KRR 和 RF 的误差均值都略低于 GraphConv。这个结果说明固定协议下没有重现图模型的优势。我们没有为得到更漂亮的排序重新选择种子，也没有把未经验证的训练配置差异当成已确定的原因。');
resultsSlide('lipophilicity','脂溶性任务中 GraphConv 的平均误差最低',
  'GraphConv 为 0.704，RF / KRR 约为 0.84\n本次 GraphConv 仍略高于论文的 0.655',
  'Lipophilicity 的结果与 ESOL 在模型排序上相似：GraphConv 平均误差最低，RF 和 KRR 接近。GraphConv 的误差是零点七零四，论文对应数值为零点六五五。这个结果支持图表示在当前协议和当前任务中的价值，但不足以外推到所有分子性质，更不能直接转化为药物发现成功率的保证。');

s=newSlide('骨架划分提高了 ESOL 的测试误差',
  '测试 RMSE，log10(mol/L)。骨架划分固定，不是三折交叉验证。',
  `同一组模型转到 ESOL 骨架测试集后，误差均值都升高。KRR 从一点四八五上升到二点四七二，甚至高于二点三一五的均值基线。GraphConv 仍是本轮骨架测试中的最低误差模型，但也从一点零四六升到一点三七零。这里展示的是一个特定固定骨架分区的诊断结果，不能把差值解释为普遍适用的外推损失。\n\n来源：${dataSources.audit}`);
table(s,'scaffold',['模型','随机划分','骨架划分'],models.map(model=>[modelNames[model],metric(run('esol',model)),metric(run('esol',model,'scaffold'))]),[80,244,1440,352]);
text(s,'negative','骨架测试中，KRR 比均值基线更差',[80,647,1420,74],40,C.accent,true);
text(s,'meaning','随机划分成绩不能替代新骨架外推评估',[80,738,1420,56],30,C.muted);

s=newSlide('FreeSolv 的数据单位错误已纠正并重跑',
  '来源：data/freesolv/SOURCE-CORRECTION.md。错误批次未进入最终汇总。',
  `在数据审计时发现，DeepChem 2.8 默认下载的 FreeSolv 压缩文件已经进行全数据标准化。若直接把其误差标成每摩尔千卡，就会产生大约三点八四五倍的虚假改善。我们改用原始 SAMPL.csv 的 expt 列，只在训练集上拟合标准化，并将相关实验完整重跑。前面所有 FreeSolv 数字都来自纠正后的批次。这个案例说明数据尺度检查比单纯跑通模型更重要。\n\n来源：${dataSources.audit}\n../moleculenet-reproduction-20260918/data/freesolv/SOURCE-CORRECTION.md`);
text(s,'factor','3.845×',[82,225,1370,145],100,C.accent,true);
text(s,'factor-label','误把标准化误差标成 kcal/mol 时的虚假改善幅度',[84,397,1390,84],37);
text(s,'fix','纠正后使用原始 SAMPL.csv 的 expt 列',[84,555,1410,68],40,C.primary,true);
text(s,'fix-detail','仅训练集拟合标准化；完整重跑并排除错误批次',[84,648,1410,84],35);

s=newSlide('重复结构限制随机划分的外推解释',
  '来源：verification/summary.json、diagnostics.json。结构按规范 SMILES 核对。',
  `ESOL 有十一条重复结构记录。三个随机种子下，训练集和测试集之间的相同规范结构交集分别为二、二和零。FreeSolv 与 Lipophilicity 没有发现这种交叉。这里没有为了消除重复而改变事先确定的全量数据协议，所以必须如实报告。另一方面，已独立核对所有运行的预测与标签、分区覆盖、指标、归一化及数据哈希。数据可核查不等于所有科学偏差已消除。\n\n来源：${dataSources.audit}`);
table(s,'leakage',['数据集','重复结构行','训练 / 测试同结构交集'],[
 ['ESOL','11','2 / 2 / 0'],['FreeSolv','0','0 / 0 / 0'],['Lipophilicity','0','0 / 0 / 0'],
],[80,237,1440,289]);
text(s,'seeds','交集按种子 123、456、789 顺序列出',[80,553,1400,62],29,C.muted);
text(s,'audit','48 次运行均保留逐分子预测与分区索引',[80,657,1430,76],39,C.primary,true);
text(s,'audit-note','独立重算指标，并核对标签、单位、哈希与训练集标准化',[80,741,1430,57],29);

s=newSlide('本次结果仍有明确的复现边界',
  '来源：原论文方法与本地固定实验协议。差异不能单独解释某一个结果。',
  `论文比较与本地重跑之间存在多处差异。数据范围只覆盖三个理化性质集合，软件使用较新的 DeepChem 与 TensorFlow，没有还原原论文的全部模型和超参数搜索。原论文使用的精确种子与分区索引也未在本轮恢复。这些差异提醒我们，对结果应使用描述性语言，而不是宣称已经证明某种算法一定更好或更差。完整论文复现仍然没有完成。\n\n来源：${dataSources.paper}\n${dataSources.audit}`);
text(s,'done-title','本轮已完成',[80,220,670,74],44,C.primary,true);
text(s,'done','3 个完整数据集\n4 类模型，3 个种子\n48 次训练与评估\n逐分子预测与独立指标核验',[80,328,670,370],38);
text(s,'not-title','本轮未覆盖',[850,220,670,74],44,C.accent,true);
text(s,'not','全 17 数据集与全部算法\n原论文超参数搜索\n原始环境与精确分区还原\n湿实验、临床或靶点验证',[850,328,670,370],38);

s=newSlide('AIDD 基准结果应按任务和划分解读',
  '依据：本轮三个任务结果与 ESOL 骨架诊断。以下为方法学解读。',
  `本轮实验提供了三个实际可用的判断。第一，模型优势依赖任务，GraphConv 在 ESOL 和脂溶性上平均误差最低，但在 FreeSolv 上没有显示同样优势。第二，随机与骨架划分衡量不同的泛化条件，不应互相替代。第三，数据单位、重复结构和独立指标核验是解释结果的前提。这些结论对评估 AIDD 模型有帮助，但当前实验仍然只是性质预测基准，不能提供药物有效性证据。\n\n来源：${dataSources.audit}\n${dataSources.paper}`,true);
text(s,'finding1','模型优势依赖具体任务',[84,222,1400,76],49,s.visualSpec.palette.primary,true);
text(s,'detail1','FreeSolv 的负结果，与 ESOL、脂溶性的排序并存',[84,311,1390,72],35);
text(s,'finding2','外推能力需要相匹配的划分',[84,446,1400,76],49,s.visualSpec.palette.primary,true);
text(s,'detail2','随机划分中的低误差，不能保证新骨架上的表现',[84,535,1390,72],35);
text(s,'closing','这份结果支持基准评估，不构成候选药物有效性的证据',[84,704,1390,86],34,s.visualSpec.palette.muted);

s=newSlide('文献与可复运行证据',
  '实验资料日期：2026-09-18。当前报告保留局部复现范围与原始负结果。',
  `文献通过 PubMed 和 DOI 定位。数值对照使用作者稿第三版的 Table 8，避免期刊与作者稿图号混用。本地证据包括固定配置、训练脚本、原始预测、分区以及独立核验汇总。复运行时应使用新的输出目录，以免覆盖既有结果。不同硬件或库版本不保证逐位相同。\n\n${dataSources.paper}\n${dataSources.table}\nDeepChem 2.8.0: https://github.com/deepchem/deepchem/tree/2.8.0\n${dataSources.audit}\n参考路径均相对本报告所属工作区的历史实验目录。`);
text(s,'citation','Wu et al. MoleculeNet\nChemical Science 9, 513–530 (2018)',[80,219,1430,133],41,C.primary,true);
text(s,'doi','DOI 10.1039/C7SC02664A    PMID 29629118',[80,378,1430,68],32);
text(s,'artifact-heading','本地复运行与审计入口',[80,499,1430,69],41,C.primary,true);
text(s,'artifact-list','experiment.json / benchmark.py\nverification/summary.json / runs.json\nresults/ 与 results-corrected/：预测、分区、指标',[80,593,1430,161],33);

if(slides.length!==TOTAL)throw new Error('Unexpected slide count');
if(!exporter.canExportCanvasSlidesToPptx(slides))throw new Error('Native exporter rejected Canvas payload');
for(const slide of slides) {
  for(const item of slide.layoutIr.nodes) {
    const {x,y,w,h}=item.box;
    if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<=0||h<=0||x+w>W+.01||y+h>H+.01)throw new Error(`Invalid box ${slide.pageNum}/${item.nodeId}`);
  }
}
await fs.writeFile(path.join(buildDir,'slides.canvas.json'),JSON.stringify(slides,null,2));
await fs.writeFile(path.join(buildDir,'deck-theme.json'),JSON.stringify(theme,null,2));
await fs.writeFile(path.join(buildDir,'content-and-notes.json'),JSON.stringify(records,null,2));

// Real upstream Paper2Any entry point. No direct PptxGenJS authoring or API call here.
const blob=await exporter.buildCanvasSlidesPptxBlob(slides,theme);
const nativePath=path.join(buildDir,'paper2any-native-export.pptx');
const bytes=new Uint8Array(await blob.arrayBuffer());
await fs.writeFile(nativePath,bytes);
const receipt={
  mode:'current-codex-authored-canvas-to-native-paper2any-export',
  pi_invoked:false,external_model_api_invoked:false,deepseek_invoked:false,
  reused_prior_model_outline_or_slides:false,experiment_rerun:false,
  evidence_path:summaryPath,evidence_sha256:createHash('sha256').update(await fs.readFile(summaryPath)).digest('hex'),
  upstream_commit:'b538531e25798d9b9d41afd5fa93c9222949b5a5',
  exporter_path:sourcePath,exporter_sha256:createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex'),
  native_export_path:nativePath,native_export_bytes:bytes.length,
  native_export_sha256:createHash('sha256').update(bytes).digest('hex'),slide_count:slides.length,
  model_generation_service_executed:false,
};
await fs.writeFile(path.join(buildDir,'native-export-receipt.json'),JSON.stringify(receipt,null,2));
const mdTable=(b:any)=>`| ${b.headers.join(' | ')} |\n| ${b.headers.map(()=>'---').join(' | ')} |\n${b.rows.map((r:string[])=>`| ${r.join(' | ')} |`).join('\n')}`;
await fs.writeFile(path.join(taskDir,'deliverables','slides.md'),'---\nmarp: true\nsize: 16:9\n---\n\n'+records.map(r=>`# ${r.title}\n\n${r.blocks.map((b:any)=>typeof b==='string'?b.replace(/\n/g,'  \n'):b.headers?mdTable(b):`![${b.alt}](${b.image})`).join('\n\n')}\n\n来源：${r.sources}\n\n<!-- NOTES\n${r.notes}\n-->`).join('\n\n---\n\n'));
await fs.writeFile(path.join(taskDir,'deliverables','notes.md'),'# MoleculeNet 局部复现说明讲稿\n\n适用：科研组会，约 12–15 分钟。页数与时长为本轮默认设计，不是实验计时。\n\n'+records.map(r=>`## ${r.page}. ${r.title}\n\n${r.notes}`).join('\n\n')+'\n\n## 修改与复用\n\n1. 修改 Canvas 页面中的 content 数据。\n2. 保持每个数值的单位和来源。\n3. 样本或模型变动后重新生成独立审计汇总。\n4. 调整版式后重新导出并逐页检查。\n5. 用新文件名保存，保留历史实验与报告。\n');
console.log(JSON.stringify(receipt,null,2));
