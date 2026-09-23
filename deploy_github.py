#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键部署到 GitHub（无需本机安装 git）

原理：直接调用 GitHub REST API
  1) 创建仓库（可选 Private / Public）
  2) 逐个上传文件为 blob
  3) 组装 tree → 创建 commit → 建立 main 分支引用
  4) 创建 xwk-persist 孤儿分支（存放云端持久化快照）

用法：
  python deploy_github.py --token ghp_xxx --repo xwk-knowledge-base --private
  python deploy_github.py --token ghp_xxx --repo xwk-knowledge-base --public
"""
import argparse, base64, io, json, os, sys, time, urllib.request, urllib.error

API = "https://api.github.com"
ROOT = os.path.dirname(os.path.abspath(__file__))

# 只推送这些文件/目录；排除依赖、运行时数据库、本地快照
INCLUDE_FILES = {
    "server.js", "persistence.js", "tunnel.js", "deploy_github.py",
    "package.json", "package-lock.json",
    "README.md", "Dockerfile", "render.yaml", "railway.json", ".gitignore",
    "启动服务.bat", "启动外网访问.bat",
    "public/index.html", "public/style.css", "public/app.js",
    "data/seed.json", "data/plan19.json",
    "data/jobs_batch1.json", "data/jobs_batch2.json", "data/jobs_batch3.json",
    "data/jobs_batch4.json", "data/jobs_batch5.json",
}
EXCLUDE_DIR_PARTS = ("node_modules", "persist", ".git")
EXCLUDE_NAME_PAT = ("xwk.db", "polluted-bak")


def gh(token, method, path, body=None, raw=False):
    url = API + path if path.startswith("/") else path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "xwk-deploy")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            payload = r.read()
            return r.status, (payload if raw else (json.loads(payload.decode()) if payload else {}))
    except urllib.error.HTTPError as e:
        payload = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, {"message": payload[:400]}
    except Exception as e:
        return -1, {"message": str(e)}


def collect():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIR_PARTS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            if any(p in rel for p in EXCLUDE_NAME_PAT):
                continue
            if rel not in INCLUDE_FILES:
                continue
            out.append((rel, full))
    out.sort()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--token", default=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "",
                    help="GitHub Personal Access Token（需 repo 权限）；也可用环境变量 GITHUB_TOKEN 传入")
    ap.add_argument("--repo", default="xwk-knowledge-base", help="仓库名")
    ap.add_argument("--desc", default="小微行业知识库管理系统 V3 · 行业/职业/城市风控看板（99行业·528岗位·20城）")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--private", action="store_true", help="私有仓库（推荐：含账号数据与内部业务资料）")
    g.add_argument("--public", action="store_true", help="公开仓库")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--persist-branch", default="xwk-persist")
    a = ap.parse_args()

    private = True if a.private else (False if a.public else True)

    print("=" * 72)
    print("  小微行业知识库 V3 · GitHub 部署")
    print("=" * 72)

    # 0) 验证 token 并取用户名
    st, me = gh(a.token, "GET", "/user")
    if st != 200:
        print(f"\n✗ Token 无效或权限不足（HTTP {st}）：{me.get('message','')}")
        print("  请确认 PAT 勾选了 repo 权限（classic token 勾 repo；fine-grained 需 Contents+Administration 读写）")
        sys.exit(1)
    owner = me["login"]
    print(f"\n✓ Token 有效，账号：{owner}")

    # 1) 建仓库
    st, r = gh(a.token, "GET", f"/repos/{owner}/{a.repo}")
    if st == 200:
        print(f"✓ 仓库已存在：{owner}/{a.repo}（{'私有' if r.get('private') else '公开'}），将在其上提交")
        repo_full = f"{owner}/{a.repo}"
        if private and not r.get("private"):
            print("  ⚠️ 现有仓库是公开的。若要存账号快照请务必到 GitHub 设置里改为 Private，")
            print("     否则服务端会自动跳过账号数据推送（已内置保护）。")
    else:
        st, r = gh(a.token, "POST", "/user/repos", {
            "name": a.repo, "description": a.desc, "private": private,
            "auto_init": False, "has_issues": True, "has_wiki": False,
        })
        if st not in (200, 201):
            print(f"\n✗ 创建仓库失败（HTTP {st}）：{r.get('message','')}")
            if r.get("errors"):
                for e in r["errors"][:5]:
                    print(f"    - {e}")
            sys.exit(1)
        repo_full = r["full_name"]
        print(f"✓ 已创建{'私有' if private else '公开'}仓库：{repo_full}")

    # 2) 收集文件
    files = collect()
    if not files:
        print("\n✗ 没有收集到任何文件，请检查脚本位置")
        sys.exit(1)
    total = sum(os.path.getsize(f) for _, f in files)
    print(f"\n待推送 {len(files)} 个文件，共 {total/1024/1024:.2f} MB：")
    for rel, full in files:
        print(f"    {rel:<34} {os.path.getsize(full)/1024:>8.1f} KB")

    # 3) 空仓库初始化：blob API 要求对象库已存在，先用 contents API 建初始提交
    st, r = gh(a.token, "GET", f"/repos/{repo_full}/git/ref/heads/{a.branch}")
    if st != 200:
        print("\n初始化空仓库…")
        init_b64 = base64.b64encode(
            "# 小微行业知识库管理系统 V3\n\n初始化提交，随后推送完整项目。\n".encode("utf-8")
        ).decode()
        st, r = gh(a.token, "PUT", f"/repos/{repo_full}/contents/README.md", {
            "message": "chore: 初始化仓库",
            "content": init_b64,
            "branch": a.branch,
        })
        if st not in (200, 201):
            print(f"✗ 初始化仓库失败（HTTP {st}）：{r.get('message','')}")
            sys.exit(1)
        print(f"✓ 仓库已初始化（{a.branch} 分支）")

    # 4) 上传 blob
    print("\n上传文件…")
    tree_items = []
    for i, (rel, full) in enumerate(files, 1):
        with open(full, "rb") as fh:
            content = fh.read()
        st, r = gh(a.token, "POST", f"/repos/{repo_full}/git/blobs",
                   {"content": base64.b64encode(content).decode(), "encoding": "base64"})
        if st not in (200, 201):
            print(f"  ✗ {rel} 上传失败（HTTP {st}）：{r.get('message','')}")
            sys.exit(1)
        tree_items.append({"path": rel, "mode": "100644", "type": "blob", "sha": r["sha"]})
        if i % 5 == 0 or i == len(files):
            print(f"    {i}/{len(files)}")
        time.sleep(0.12)

    # 5) 组装 tree + commit + 更新引用
    st, r = gh(a.token, "GET", f"/repos/{repo_full}/git/ref/heads/{a.branch}")
    base_sha = r["object"]["sha"] if st == 200 else None

    st, r = gh(a.token, "POST", f"/repos/{repo_full}/git/trees",
               {"tree": tree_items, **({"base_tree": base_sha} if base_sha else {})})
    if st not in (200, 201):
        print(f"\n✗ 创建 tree 失败（HTTP {st}）：{r.get('message','')}")
        sys.exit(1)
    tree_sha = r["sha"]

    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    msg = (f"feat: 小微行业知识库管理系统 V3 Web 版\n\n"
           f"数据源：小微行业知识库看板V3.xlsx\n"
           f"- 99 个细分行业 / 528 条岗位核实明细 / 127 条经营模式 / 20 城 × 99 行业风险分级\n"
           f"- 看板严格复刻 Excel 20/21/22 表筛选公式（行业定位、职业勾选、城市筛选）\n"
           f"- 职业字段「面签时怎么问」统一改为「审核时怎么问」\n"
           f"- 补写 19 个行业共 109 条岗位明细（原 _m04 未覆盖）\n"
           f"- 三级权限（超管/编辑/浏览）、登录 IP 与设备审计、在线编辑留痕\n"
           f"- 内置 Git 分支持久化，适配免费云平台重启不丢数据\n\n"
           f"构建时间：{stamp}")
    payload = {"message": msg, "tree": tree_sha}
    if base_sha:
        payload["parents"] = [base_sha]
    st, r = gh(a.token, "POST", f"/repos/{repo_full}/git/commits", payload)
    if st not in (200, 201):
        print(f"\n✗ 创建 commit 失败（HTTP {st}）：{r.get('message','')}")
        sys.exit(1)
    commit_sha = r["sha"]

    if base_sha:
        st, r = gh(a.token, "PATCH", f"/repos/{repo_full}/git/refs/heads/{a.branch}",
                   {"sha": commit_sha, "force": True})
    else:
        st, r = gh(a.token, "POST", f"/repos/{repo_full}/git/refs",
                   {"ref": f"refs/heads/{a.branch}", "sha": commit_sha})
    if st not in (200, 201):
        print(f"\n✗ 更新分支引用失败（HTTP {st}）：{r.get('message','')}")
        sys.exit(1)
    print(f"\n✓ 已推送到 {a.branch} 分支：{commit_sha[:10]}")

    # 5) 创建持久化孤儿分支（若不存在）
    st, r = gh(a.token, "GET", f"/repos/{repo_full}/branches/{a.persist_branch}")
    if st == 200:
        print(f"✓ 持久化分支 {a.persist_branch} 已存在")
    else:
        readme = (f"# 持久化分支\n\n此分支由程序自动维护，存放账号、人工编辑内容与日志快照。\n"
                  f"**请勿手动修改，也不要基于此分支部署。**\n\n主分支：`{a.branch}`\n")
        st, rb = gh(a.token, "POST", f"/repos/{repo_full}/git/blobs",
                    {"content": base64.b64encode(readme.encode()).decode(), "encoding": "base64"})
        st, rt = gh(a.token, "POST", f"/repos/{repo_full}/git/trees",
                    {"tree": [{"path": "README.md", "mode": "100644", "type": "blob", "sha": rb["sha"]}]})
        st, rc = gh(a.token, "POST", f"/repos/{repo_full}/git/commits",
                    {"message": "chore: 初始化持久化分支 [skip ci]", "tree": rt["sha"]})
        if st in (200, 201):
            gh(a.token, "POST", f"/repos/{repo_full}/git/refs",
               {"ref": f"refs/heads/{a.persist_branch}", "sha": rc["sha"]})
            print(f"✓ 已创建持久化分支 {a.persist_branch}")
        else:
            print(f"⚠ 持久化分支创建失败（HTTP {st}）：{rc.get('message','')} —— 可稍后由服务自动创建")

    print("\n" + "=" * 72)
    print("  部署到 GitHub 完成")
    print("=" * 72)
    print(f"\n  仓库地址：https://github.com/{repo_full}")
    print(f"  主分支：  {a.branch}")
    print(f"  持久化：  {a.persist_branch}（程序自动读写，勿手动改）")
    print(f"\n  下一步 —— 让网站永久在线（二选一）：")
    print(f"\n  【Render】https://render.com  → New + → Blueprint → 选 {repo_full}")
    print(f"     会自动读取 render.yaml。然后在服务 Environment 里填两个变量：")
    print(f"       GITHUB_TOKEN = 你的 PAT（需 repo 权限）")
    print(f"       GITHUB_REPO  = {repo_full}")
    print(f"     部署完成后会给你一个 https://xxx.onrender.com 永久地址。")
    print(f"\n  【Railway】https://railway.app → New Project → Deploy from GitHub repo")
    print(f"     选 {repo_full}，然后在 Variables 里加同样两个变量。")
    print(f"\n  ⚠️ 部署上线后请立即：")
    print(f"     1. 用 gaoyuxi / wt1201263 登录并修改密码")
    print(f"     2. 确认仓库为 Private（公开仓库会自动跳过账号数据持久化）")
    print(f"     3. 到「系统管理 → 系统自检与设置」点一次「立即保存快照」")
    print("=" * 72)


if __name__ == "__main__":
    main()
