#!/usr/bin/env node
/* 题库校验：在部署前拦住会让页面出错或判分错误的改动。
   选择题  至少 4 个选项、选项互不重复、无占位符、题干全库唯一、题目 id 不撞
   填空题  ____ 个数等于答案组数、每组至少 1 个可接受答案、标准答案用页面自己的判分函数能判对
   主观题  题型合法、得分点不少于满分、关键词正则能编译、参考答案用页面自己的判分函数能命中每个得分点
   数量    够组一套 50 选择 + 10 填空 + 5 名词解释 + 5 简答 + 3 案例分析 */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const SITE = path.join(__dirname, "..", "site");
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

const ctx = { window: {} };
vm.createContext(ctx);
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
for (const f of srcs) vm.runInContext(fs.readFileSync(path.join(SITE, f), "utf8"), ctx, { filename: f });

// 直接取页面里的判分函数，保证校验与线上判分一致
const a = html.indexOf("function norm("), b = html.indexOf("/* ---------- 交卷");
vm.runInContext(html.slice(a, b), ctx);
const blankOK = ctx.blankOK, ptHit = ctx.ptHit, norm = ctx.norm;

function hash(s){ let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

const errors = [], seenQ = {}, seenId = {}, perUnit = {};
let nM = 0, nF = 0;
for (const p of ctx.window.MCQ_PARTS || []) {
  const k = p.c + " / " + p.u; perUnit[k] = perUnit[k] || [0, 0];
  for (const it of p.items) {
    nM++; perUnit[k][0]++;
    const [q, o, e] = it, where = `《${String(q).slice(0, 24)}》(${p.u})`;
    if (typeof q !== "string" || !Array.isArray(o) || typeof e !== "string") { errors.push(where + " 结构不对"); continue; }
    if (o.length < 4) errors.push(where + ` 只有 ${o.length} 个选项`);
    if (new Set(o).size !== o.length) errors.push(where + " 有重复选项");
    if (o.some(x => !String(x).trim() || /^[—\-]+$/.test(x))) errors.push(where + " 有空选项或占位符");
    if (seenQ[q]) errors.push(where + " 题干与 " + seenQ[q] + " 重复"); else seenQ[q] = p.u;
    const id = "m" + hash(p.u + "|" + q);
    if (seenId[id]) errors.push(where + " id 撞车"); seenId[id] = 1;
  }
}
for (const p of ctx.window.FILL_PARTS || []) {
  const k = p.c + " / " + p.u; perUnit[k] = perUnit[k] || [0, 0];
  for (const it of p.items) {
    nF++; perUnit[k][1]++;
    const [q, ans] = it, where = `填空《${String(q).slice(0, 24)}》(${p.u})`;
    const parts = q.split("____");
    if (parts.length - 1 !== ans.length) errors.push(where + `: ${parts.length - 1} 个空位对应 ${ans.length} 组答案`);
    if (ans.length > 2) errors.push(where + ": 每题最多 2 个空");
    ans.forEach((g, i) => {
      if (!Array.isArray(g) || !g.length) { errors.push(where + ` 第 ${i + 1} 空没有可接受答案`); return; }
      g.forEach(x => { if (!blankOK(x, g, parts[i + 1])) errors.push(where + ` 第 ${i + 1} 空的答案「${x}」判不对`); });
    });
    if (seenQ[q]) errors.push(where + " 题干重复"); else seenQ[q] = p.u;
    const id = "f" + hash(p.u + "|" + q);
    if (seenId[id]) errors.push(where + " id 撞车"); seenId[id] = 1;
  }
}
const SA_NEED = { "名词": [5, 2], "简答": [5, 3], "案例": [3, 5] }, saCnt = { "名词": 0, "简答": 0, "案例": 0 };
for (const p of ctx.window.SA_PARTS || []) {
  const k = p.c + " / " + p.u; perUnit[k] = perUnit[k] || [0, 0]; perUnit[k][2] = perUnit[k][2] || [0, 0, 0];
  for (const it of p.items) {
    const where = `${it.t}《${String(it.q).slice(0, 20)}》(${p.u})`;
    if (!SA_NEED[it.t]) { errors.push(where + " 题型只能是 名词/简答/案例"); continue; }
    saCnt[it.t]++; perUnit[k][2][["名词", "简答", "案例"].indexOf(it.t)]++;
    if (typeof it.q !== "string" || typeof it.r !== "string" || !Array.isArray(it.p)) { errors.push(where + " 结构不对"); continue; }
    if (it.p.length < SA_NEED[it.t][1]) errors.push(where + ` 得分点 ${it.p.length} 个，少于满分 ${SA_NEED[it.t][1]}`);
    const ref = norm(it.r);
    it.p.forEach((pt, i) => {
      if (!Array.isArray(pt) || pt.length < 2) { errors.push(where + ` 第 ${i + 1} 个得分点没有关键词`); return; }
      for (const g of pt.slice(1)) if (g.startsWith("re:")) { try { new RegExp(g.slice(3)); } catch (e) { errors.push(where + ` 正则写错：${g}`); } }
      try { if (!ptHit(ref, pt)) errors.push(where + ` 参考答案命中不了得分点「${pt[0]}」`); } catch (e) {}
    });
    const id = "s" + hash(p.u + "|" + it.t + "|" + it.q);
    if (seenId[id]) errors.push(where + " id 撞车"); seenId[id] = 1;
  }
}
for (const t in SA_NEED) if (saCnt[t] < SA_NEED[t][0]) errors.push(`${t}题不足 ${SA_NEED[t][0]} 道（当前 ${saCnt[t]}）`);

if (nM < 50) errors.push(`选择题不足 50 道（当前 ${nM}）`);
if (nF < 10) errors.push(`填空题不足 10 道（当前 ${nF}）`);

for (const k in perUnit) { const sa = perUnit[k][2] || [0, 0, 0]; console.log(`  ${k}: 选择 ${perUnit[k][0]}，填空 ${perUnit[k][1]}，名词 ${sa[0]}，简答 ${sa[1]}，案例 ${sa[2]}`); }
console.log(`选择题 ${nM} 道，填空题 ${nF} 道，名词解释 ${saCnt["名词"]} 道，简答题 ${saCnt["简答"]} 道，案例分析 ${saCnt["案例"]} 道`);
if (errors.length) { console.log("\n题库校验未通过："); errors.forEach(e => console.log("  - " + e)); process.exit(1); }
console.log("题库校验通过");
