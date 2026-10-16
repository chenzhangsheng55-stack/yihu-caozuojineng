#!/usr/bin/env node
/* 题库校验：在部署前拦住会让页面出错或判分错误的改动。
   选择题  至少 4 个选项、选项互不重复、无占位符、题干全库唯一、题目 id 不撞
   填空题  ____ 个数等于答案组数、每组至少 1 个可接受答案、标准答案用页面自己的判分函数能判对
   数量    够组一套 50 选择 + 10 填空 */
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
const blankOK = ctx.blankOK;

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
if (nM < 50) errors.push(`选择题不足 50 道（当前 ${nM}）`);
if (nF < 10) errors.push(`填空题不足 10 道（当前 ${nF}）`);

for (const k in perUnit) console.log(`  ${k}: 选择 ${perUnit[k][0]}，填空 ${perUnit[k][1]}`);
console.log(`选择题 ${nM} 道，填空题 ${nF} 道`);
if (errors.length) { console.log("\n题库校验未通过："); errors.forEach(e => console.log("  - " + e)); process.exit(1); }
console.log("题库校验通过");
