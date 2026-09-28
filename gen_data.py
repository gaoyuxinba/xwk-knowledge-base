#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_data.py — 数据处理脚本
1) 读取 seed.json
2) 生成薪资趋势数据（2020-2026年7年）
3) 生成城市调整系数
4) 拆分为4个JS文件输出到 public/static/
"""
import json, os, re, math

ROOT = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(ROOT, "data", "seed.json")
OUT = os.path.join(ROOT, "public", "static")
os.makedirs(OUT, exist_ok=True)

# ============================================================ 行业门类基准月薪
CATEGORY_BASE = {
    "建筑业": 7000, "制造业": 6500, "批发和零售业": 5500, "餐饮业": 5000,
    "交通运输业": 6000, "农林牧渔业": 4800, "居民服务业": 4500,
    "信息传输": 9000, "软件和信息技术": 9500, "金融业": 10000,
    "教育": 6000, "卫生和社会工作": 7000, "物流": 6000,
    "住宿业": 4800, "租赁业": 5500, "文化娱乐": 5800,
    "采矿业": 7500, "电力热力": 8000, "建筑业 ": 7000,
}
DEFAULT_BASE = 5500

# ============================================================ 职位关键词倍数
def job_multiplier(title):
    t = str(title or "")
    if any(k in t for k in ["工程师", "技术", "开发", "设计", "架构", "算法"]):
        return 1.30
    if any(k in t for k in ["经理", "主管", "总监", "负责人", "店长", "厂长"]):
        return 1.40
    if any(k in t for k in ["长", "队长", "组长"]):
        return 1.20
    if any(k in t for k in ["司机", "操作", "搬运", "保洁", "保安"]):
        return 0.88
    if any(k in t for k in ["学徒", "实习", "助理", "帮工", "杂工"]):
        return 0.72
    if any(k in t for k in ["员", "工", "师"]):
        return 1.00
    return 1.00

# ============================================================ 年度趋势因子
YEAR_FACTORS = {
    "2020": 0.87, "2021": 0.92, "2022": 0.97, "2023": 0.98,
    "2024": 1.05, "2025": 1.12, "2026": 1.19,
}

# ============================================================ 城市调整系数
CITY_FACTORS = {
    "重庆": 1.00, "成都": 0.95, "西安": 0.88, "北京": 1.65, "上海": 1.60,
    "深圳": 1.55, "广州": 1.45, "杭州": 1.42, "武汉": 1.15, "南京": 1.35,
    "青岛": 1.12, "郑州": 1.05, "长沙": 1.08, "苏州": 1.38, "东莞": 1.28,
    "合肥": 1.10, "佛山": 1.22, "天津": 1.30, "宁波": 1.33, "太原": 0.92,
}

# ============================================================ 需求热度判断
def determine_demand(industry, job_title):
    outlook = str(industry.get("前景趋势判断", ""))
    if any(k in outlook for k in ["旺盛", "高速", "爆发", "紧缺", "上升"]):
        return "高"
    if any(k in outlook for k in ["稳定", "平缓", "成熟", "饱和"]):
        return "中"
    title = str(job_title or "")
    if any(k in title for k in ["工程师", "技术", "开发", "设计", "数据"]):
        return "高"
    if any(k in title for k in ["司机", "搬运", "学徒", "杂工"]):
        return "低"
    return "中"

def growth_rate_str(first, last):
    if first <= 0:
        return "0-3%"
    pct = (last - first) / first * 100
    if pct < 3:
        return "0-3%"
    if pct < 5:
        return "3-5%"
    if pct < 8:
        return "5-8%"
    if pct < 12:
        return "8-12%"
    return "12%+"

def base_for_category(cat):
    cat = str(cat or "").strip()
    for k, v in CATEGORY_BASE.items():
        if k in cat or cat in k:
            return v
    return DEFAULT_BASE

# ============================================================ 生成薪资数据
def gen_salary(seed):
    industries = seed.get("industries", [])
    jobs = seed.get("jobs", [])
    ind_map = {r["行业编号"]: r for r in industries}
    salary = {}
    for job in jobs:
        code = job.get("行业编号", "")
        title = job.get("常见职位", "")
        ind = ind_map.get(code, {})
        cat = ind.get("行业门类", "")
        base = base_for_category(cat) * job_multiplier(title)
        base = round(base / 10) * 10
        lo = round(base * 0.75 / 10) * 10
        hi = round(base * 1.35 / 10) * 10

        trend = {}
        for yr, factor in YEAR_FACTORS.items():
            m = round(base * factor / 10) * 10
            trend[yr] = {
                "min": round(lo * factor / 10) * 10,
                "max": round(hi * factor / 10) * 10,
                "median": m,
            }

        first_median = trend["2020"]["median"]
        last_median = trend["2026"]["median"]
        growth = growth_rate_str(first_median, last_median)
        demand = determine_demand(ind, title)

        salary[f"{code}|{title}"] = {
            "monthly_min": lo,
            "monthly_max": hi,
            "monthly_median": base,
            "annual_min": lo * 12,
            "annual_max": hi * 12,
            "annual_median": base * 12,
            "trend": trend,
            "demand": demand,
            "growth_rate": growth,
        }
    return salary

# ============================================================ 主流程
def main():
    with open(SEED, "r", encoding="utf-8") as f:
        seed = json.load(f)

    salary = gen_salary(seed)

    data1 = {
        "meta": seed.get("meta", {}),
        "industries": seed.get("industries", []),
        "modes": seed.get("modes", []),
        "cities": seed.get("cities", []),
    }
    data2 = {"jobs": seed.get("jobs", [])}
    data3 = {"city_risks": seed.get("city_risks", [])}
    data4 = {"salary": salary, "city_factors": CITY_FACTORS}

    files = [
        ("data1.js", "window.XWK_DATA_1=", data1),
        ("data2.js", "window.XWK_DATA_2=", data2),
        ("data3.js", "window.XWK_DATA_3=", data3),
        ("data4.js", "window.XWK_DATA_4=", data4),
    ]

    for name, prefix, obj in files:
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            f.write(prefix + json.dumps(obj, ensure_ascii=False))
        size_kb = os.path.getsize(path) / 1024
        print(f"  {name}: {size_kb:.0f} KB")

    total = sum(os.path.getsize(os.path.join(OUT, n)) for n, _, _ in files)
    print(f"Total: {total / 1024:.0f} KB")

if __name__ == "__main__":
    print("Generating data files...")
    main()
    print("Done.")
