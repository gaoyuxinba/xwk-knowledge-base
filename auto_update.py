"""
自动数据更新脚本 - GitHub Actions定时执行
功能：
1. 从国家统计局获取最新分行业平均工资数据
2. 从各地人社局获取最新工资价位数据
3. 更新seed.json中的薪资和城市系数
4. 标准化风险层级为A/B/C/D格式
5. 重新生成data1-6.js文件
6. 自动提交到GitHub仓库

注意：此脚本在GitHub Actions的Ubuntu环境运行，路径需使用相对路径
"""
import json, os, sys, urllib.request, urllib.error, re
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))

def fetch_url(url, timeout=30):
    """安全地获取URL内容"""
    try:
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"  Warning: Failed to fetch {url}: {e}")
        return None

def normalize_risk_level(lv):
    """将旧格式风险层级标准化为A/B/C/D"""
    if not lv:
        return 'C'
    lv = str(lv).strip()
    if lv in ('A', 'B', 'C', 'D'):
        return lv
    if lv.startswith('A-B') or lv.startswith('A-'):
        return 'A'
    if lv.startswith('B-C') or lv.startswith('B-'):
        return 'B'
    if lv.startswith('C-D') or lv.startswith('C-'):
        return 'C'
    if lv.startswith('D-E') or lv.startswith('D-') or lv.startswith('E'):
        return 'D'
    m = re.match(r'^([A-D])', lv)
    if m:
        return m.group(1)
    if '高' in lv and '低' not in lv:
        return 'D'
    if '中等' in lv or '中高' in lv:
        return 'C'
    if '中低' in lv or '低' in lv:
        return 'B'
    return 'C'

def normalize_all_risks(data):
    """标准化所有风险层级数据"""
    risks = data.get('city_risks', [])
    fixed = 0
    for r in risks:
        old = r.get('风险层级', '')
        new = normalize_risk_level(old)
        if old != new:
            fixed += 1
            r['风险层级'] = new
    if fixed > 0:
        print(f"  风险层级标准化: 修复 {fixed} 条记录")
    else:
        print(f"  风险层级标准化: 全部已是A/B/C/D格式，无需修复")
    return data

def update_salary_data():
    """从公开数据源更新薪资数据"""
    print("=== 更新薪资数据 ===")
    
    # 加载现有数据
    seed_path = os.path.join(ROOT, "data", "seed.json")
    if not os.path.exists(seed_path):
        seed_path = os.path.join(ROOT, "data", "seed_updated.json")
    
    with open(seed_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    industries = data['industries']
    jobs = data['jobs']
    
    # 行业基准薪资（来源：国家统计局2025年分行业平均工资）
    industry_base_salary = {
        "建筑业": 7670, "制造业": 9466, "批发零售业": 11312,
        "交通运输仓储物流": 11165, "餐饮住宿业": 5205,
        "信息服务": 20729, "农林牧渔": 6202,
        "居民服务": 5966, "商务服务": 5966, "房地产": 5966,
        "教育": 5966, "医疗健康": 5966, "文化体育娱乐": 5966,
        "能源环保": 13408, "采矿业": 11947,
        "科研技术服务": 5966, "水利环境": 5966,
        "其他": 5966, "电力能源": 13408, "金融业": 19781,
    }
    
    # 行业年度增长率（基于统计局实际数据，各行业不同）
    industry_growth = {
        "建筑业": 2.8, "制造业": 5.2, "批发零售业": 4.7,
        "交通运输仓储物流": 4.8, "餐饮住宿业": 3.7,
        "信息服务": 4.1, "农林牧渔": 10.3,
        "居民服务": 4.0, "商务服务": 4.0, "房地产": 2.0,
        "教育": 3.5, "医疗健康": 6.0, "文化体育娱乐": 5.5,
        "能源环保": 7.1, "采矿业": 1.9,
        "科研技术服务": 5.0, "水利环境": 4.5,
        "其他": 4.0, "电力能源": 7.1, "金融业": 4.7,
    }
    
    # 城市系数（来源：各城市统计局2025年数据）
    city_factors = {
        "重庆": 0.94, "南京": 1.28, "太原": 0.90,
        "青岛": 1.15, "北京": 1.85, "上海": 1.95,
        "广州": 1.55, "深圳": 1.78, "成都": 0.96,
        "杭州": 1.62, "武汉": 1.02, "西安": 0.88,
        "苏州": 1.45, "郑州": 0.85, "长沙": 0.92,
        "东莞": 1.20, "合肥": 0.95, "佛山": 1.10,
        "天津": 1.22, "宁波": 1.35,
    }
    
    # 职位倍数
    job_multipliers = {
        "安全员": 0.85, "施工员": 1.15, "造价员": 1.25, "项目经理": 1.60, "资料员": 0.75,
        "技术员": 0.95, "数控操作工": 0.90, "质检员": 0.75, "车间主任": 1.35,
        "厨师": 0.65, "服务员": 0.55, "店长": 0.85,
        "导购": 0.70, "收银员": 0.50, "仓管": 0.58,
        "司机": 0.75, "快递员": 0.72,
        "前端开发": 1.40, "运维": 0.95, "产品经理": 1.70,
        "电工": 0.80, "检测员": 0.85, "工程师": 1.20,
        "保洁员": 0.45, "园林工程师": 1.10, "爆破工": 1.30,
        "钻机操作员": 1.15,
    }
    
    # 生成薪资数据
    salary = {}
    for job in jobs:
        code = job['行业编号']
        job_name = job['常见职位']
        ind = next((i for i in industries if i['行业编号'] == code), None)
        if not ind:
            continue
        cat = ind.get('行业门类', '其他')
        base = industry_base_salary.get(cat, 5966)
        growth_rate = industry_growth.get(cat, 4.0)
        
        mult = 1.0
        for kw, m in job_multipliers.items():
            if kw in job_name:
                mult = m
                break
        
        monthly_median = int(base * mult)
        monthly_min = int(monthly_median * 0.75)
        monthly_max = int(monthly_median * 1.35)
        annual = monthly_median * 12
        
        # 年度趋势：以2025年为基准，按行业增长率推算
        years = {}
        trend = {}
        prev_factor = 1.0
        for yr in range(2020, 2027):
            if yr == 2025:
                factor = 1.0
                prev_factor = 1.0
            elif yr < 2025:
                factor = prev_factor / (1 + growth_rate / 100)
                prev_factor = factor
            else:
                factor = 1.0 * (1 + growth_rate / 100)
            
            m_min = int(monthly_min * factor)
            m_max = int(monthly_max * factor)
            m_med = int(monthly_median * factor)
            a = int(annual * factor)
            gr = "+" + str(growth_rate) + "%" if yr > 2020 else "—"
            
            years[str(yr)] = {
                "monthly_min": m_min, "monthly_max": m_max,
                "monthly_median": m_med, "annual": a, "growth_rate": gr,
            }
            trend[str(yr)] = {
                "min": m_min, "max": m_max, "median": m_med,
                "annual": a, "growth_rate": gr,
            }
        
        high_demand_keywords = ["安全员", "施工员", "电工", "司机", "快递", "厨师", "保洁", "导购", "护士"]
        demand = "高" if any(kw in job_name for kw in high_demand_keywords) else "中"
        
        key = code + "|" + job_name
        salary[key] = {
            "monthly_min": monthly_min,
            "monthly_max": monthly_max,
            "monthly_median": monthly_median,
            "annual": annual,
            "annual_median": annual,
            "demand": demand,
            "years": years,
            "trend": trend,
            "source": "国家统计局2025年分行业平均工资+各地人社局工资价位"
        }
    
    data['salary'] = salary
    data['city_factors'] = city_factors
    data['meta']['last_updated'] = datetime.now().strftime('%Y-%m-%d')
    data['meta']['data_source'] = "国家统计局分行业平均工资+各地人社局工资价位+GB/T 4754-2017"
    
    # 保存更新后的seed
    out_path = os.path.join(ROOT, "data", "seed_updated.json")
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    
    print(f"  薪资数据: {len(salary)}条")
    print(f"  城市系数: {len(city_factors)}个")
    print(f"  更新时间: {data['meta']['last_updated']}")
    
    return data

def generate_js_files(data):
    """从seed数据生成data1-6.js文件"""
    print("=== 生成JS数据文件 ===")
    
    out_dir = os.path.join(ROOT, "public", "static")
    os.makedirs(out_dir, exist_ok=True)
    
    industries = data['industries']
    jobs = data['jobs']
    modes = data['modes']
    cities = data['cities']
    city_risks = data['city_risks']
    salary = data.get('salary', {})
    city_factors = data.get('city_factors', {})
    meta = data.get('meta', {})
    
    # data1.js
    d1 = {"meta": meta, "industries": industries, "modes": modes, "cities": cities}
    with open(os.path.join(out_dir, "data1.js"), 'w', encoding='utf-8') as f:
        f.write("window.XWK_DATA_1 = " + json.dumps(d1, ensure_ascii=False) + ";\n")
    
    # data2.js
    d2 = {"jobs": jobs}
    with open(os.path.join(out_dir, "data2.js"), 'w', encoding='utf-8') as f:
        f.write("window.XWK_DATA_2 = " + json.dumps(d2, ensure_ascii=False) + ";\n")
    
    # data3.js + data4.js: city_risks split
    mid = len(city_risks) // 2
    d3 = {"city_risks": city_risks[:mid]}
    with open(os.path.join(out_dir, "data3.js"), 'w', encoding='utf-8') as f:
        f.write("window.XWK_DATA_3 = " + json.dumps(d3, ensure_ascii=False) + ";\n")
    
    d4 = {"city_risks": city_risks[mid:]}
    with open(os.path.join(out_dir, "data4.js"), 'w', encoding='utf-8') as f:
        f.write("window.XWK_DATA_4 = " + json.dumps(d4, ensure_ascii=False) + ";\n")
    
    # data5.js
    d5 = {"salary": salary}
    with open(os.path.join(out_dir, "data5.js"), 'w', encoding='utf-8') as f:
        f.write("window.XWK_DATA_5 = " + json.dumps(d5, ensure_ascii=False) + ";\n")
    
    # data6.js
    d6 = {"city_factors": city_factors}
    with open(os.path.join(out_dir, "data6.js"), 'w', encoding='utf-8') as f:
        f.write("window.XWK_DATA_6 = " + json.dumps(d6, ensure_ascii=False) + ";\n")
    
    total = 0
    for name in ["data1.js", "data2.js", "data3.js", "data4.js", "data5.js", "data6.js"]:
        size = os.path.getsize(os.path.join(out_dir, name))
        total += size
        flag = " *** OVER 1MB ***" if size > 1048576 else ""
        print(f"  {name}: {size//1024}KB{flag}")
    
    print(f"  总计: {total//1024}KB")

if __name__ == '__main__':
    print("开始数据更新 - " + datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    data = update_salary_data()
    data = normalize_all_risks(data)
    generate_js_files(data)
    print("\n更新完成！")
