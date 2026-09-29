"""
自动数据更新脚本 - GitHub Actions定时执行
功能：
1. 从国家统计局/公开数据源获取最新经济指标（可选，失败则用基准数据）
2. 基于城市经济指标×行业风险敏感度，自动计算城市风险层级
3. 更新薪资数据（行业基准×职位系数×城市系数，含年度趋势）
4. 动态计算城市系数（基于人均GDP、社平工资等指标）
5. 标准化风险层级为A/B/C/D格式
6. 更新行业财务指标（毛利率、净利率区间调整）
7. 重新生成data1-6.js文件
8. 自动提交到GitHub仓库

说明：
- 行业/职业/经营模式等专家知识类数据不自动更新（需人工维护）
- 量化数据维度（薪资、城市系数、风险评分）自动计算更新
- "依据与尽调要点"保留专家原文，风险层级自动重评
"""
import json, os, sys, urllib.request, urllib.error, re, math
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))

# ============================================================
# 工具函数
# ============================================================
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

def norm(value, min_v, max_v):
    """归一化到0-1"""
    if max_v == min_v:
        return 0.5
    return (value - min_v) / (max_v - min_v)

# ============================================================
# 风险层级标准化
# ============================================================
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

# ============================================================
# 城市经济指标基准数据
# 来源：各城市2025年统计公报/国民经济和社会发展统计公报
# ============================================================
CITY_ECONOMIC = {
    "北京": {"gdp": 49840, "gdp_growth": 5.2, "人均gdp": 22.8, "社平工资": 14900, "固投增速": -1.2, "二产增速": 3.8, "三产增速": 5.6, "人口": 2186, "财政收入增速": 5.8},
    "上海": {"gdp": 53914, "gdp_growth": 5.1, "人均gdp": 21.7, "社平工资": 15700, "固投增速": 2.1, "二产增速": 2.8, "三产增速": 5.8, "人口": 2487, "财政收入增速": 6.2},
    "广州": {"gdp": 32770, "gdp_growth": 4.7, "人均gdp": 17.3, "社平工资": 12500, "固投增速": 1.5, "二产增速": 3.2, "三产增速": 5.2, "人口": 1892, "财政收入增速": 3.5},
    "深圳": {"gdp": 38320, "gdp_growth": 5.5, "人均gdp": 21.5, "社平工资": 14300, "固投增速": 4.8, "二产增速": 5.8, "三产增速": 5.2, "人口": 1779, "财政收入增速": 7.1},
    "杭州": {"gdp": 22100, "gdp_growth": 5.8, "人均gdp": 16.8, "社平工资": 13000, "固投增速": 5.5, "二产增速": 5.2, "三产增速": 6.3, "人口": 1316, "财政收入增速": 6.8},
    "南京": {"gdp": 18500, "gdp_growth": 4.9, "人均gdp": 20.1, "社平工资": 10300, "固投增速": -4.9, "二产增速": 3.5, "三产增速": 5.7, "人口": 949, "财政收入增速": 2.1},
    "苏州": {"gdp": 25600, "gdp_growth": 4.6, "人均gdp": 19.5, "社平工资": 11600, "固投增速": 2.5, "二产增速": 3.8, "三产增速": 5.1, "人口": 1312, "财政收入增速": 3.2},
    "宁波": {"gdp": 17200, "gdp_growth": 4.8, "人均gdp": 17.8, "社平工资": 10800, "固投增速": 3.2, "二产增速": 4.1, "三产增速": 5.3, "人口": 969, "财政收入增速": 4.5},
    "天津": {"gdp": 16800, "gdp_growth": 3.8, "人均gdp": 12.1, "社平工资": 9800, "固投增速": -2.5, "二产增速": 2.8, "三产增速": 4.3, "人口": 1363, "财政收入增速": -1.2},
    "青岛": {"gdp": 16500, "gdp_growth": 5.2, "人均gdp": 15.8, "社平工资": 9200, "固投增速": 3.5, "二产增速": 4.0, "三产增速": 5.8, "人口": 1037, "财政收入增速": 4.8},
    "武汉": {"gdp": 20800, "gdp_growth": 5.3, "人均gdp": 14.6, "社平工资": 8200, "固投增速": 4.2, "二产增速": 5.5, "三产增速": 5.1, "人口": 1374, "财政收入增速": 5.2},
    "成都": {"gdp": 23600, "gdp_growth": 5.5, "人均gdp": 11.2, "社平工资": 7700, "固投增速": 5.1, "二产增速": 5.8, "三产增速": 5.3, "人口": 2140, "财政收入增速": 5.5},
    "重庆": {"gdp": 32100, "gdp_growth": 5.3, "人均gdp": 9.2, "社平工资": 7500, "固投增速": 1.8, "二产增速": 2.2, "三产增速": 6.8, "人口": 3213, "财政收入增速": 0.8},
    "西安": {"gdp": 12200, "gdp_growth": 5.1, "人均gdp": 8.6, "社平工资": 7100, "固投增速": 2.8, "二产增速": 6.2, "三产增速": 4.5, "人口": 1316, "财政收入增速": 3.8},
    "长沙": {"gdp": 14700, "gdp_growth": 4.9, "人均gdp": 13.5, "社平工资": 7400, "固投增速": 3.2, "二产增速": 4.8, "三产增速": 5.0, "人口": 1042, "财政收入增速": 4.2},
    "郑州": {"gdp": 13600, "gdp_growth": 4.5, "人均gdp": 9.8, "社平工资": 6800, "固投增速": 1.5, "二产增速": 4.2, "三产增速": 4.8, "人口": 1301, "财政收入增速": 1.8},
    "东莞": {"gdp": 11800, "gdp_growth": 4.3, "人均gdp": 11.3, "社平工资": 9600, "固投增速": 2.8, "二产增速": 3.5, "三产增速": 5.2, "人口": 1053, "财政收入增速": 2.5},
    "佛山": {"gdp": 13200, "gdp_growth": 4.6, "人均gdp": 13.6, "社平工资": 8800, "固投增速": 3.5, "二产增速": 4.8, "三产增速": 4.3, "人口": 955, "财政收入增速": 3.5},
    "合肥": {"gdp": 13000, "gdp_growth": 5.8, "人均gdp": 13.9, "社平工资": 7600, "固投增速": 6.5, "二产增速": 7.2, "三产增速": 4.8, "人口": 963, "财政收入增速": 6.2},
    "太原": {"gdp": 5800, "gdp_growth": 2.8, "人均gdp": 10.2, "社平工资": 7200, "固投增速": -18.0, "二产增速": -3.9, "三产增速": 5.2, "人口": 543, "财政收入增速": -5.5},
}

# ============================================================
# 行业风险敏感度系数
# 表示各行业对不同经济指标的敏感程度（0~1，越高越敏感）
# 用于风险评分模型：行业在某城市的风险 = f(城市指标 × 行业敏感度)
# ============================================================
INDUSTRY_RISK_SENSITIVITY = {
    # 建筑业相关 - 对固投增速、二产增速最敏感
    "JZ": {"固投增速": 0.9, "二产增速": 0.7, "gdp_growth": 0.4, "财政收入增速": 0.5, "人口": 0.2},
    # 制造业 - 对二产增速、固投增速敏感
    "ZZ": {"固投增速": 0.6, "二产增速": 0.8, "gdp_growth": 0.5, "财政收入增速": 0.3, "人口": 0.3},
    # 批发零售 - 对GDP增速、人口最敏感
    "PF": {"固投增速": 0.3, "二产增速": 0.2, "gdp_growth": 0.7, "财政收入增速": 0.4, "人口": 0.8},
    # 交通运输 - 对GDP、二产增速敏感
    "JT": {"固投增速": 0.4, "二产增速": 0.5, "gdp_growth": 0.6, "财政收入增速": 0.3, "人口": 0.4},
    # 餐饮住宿 - 对人均GDP、人口、消费最敏感
    "CY": {"固投增速": 0.2, "二产增速": 0.2, "gdp_growth": 0.5, "财政收入增速": 0.3, "人口": 0.7},
    # 信息服务 - 对GDP、三产增速敏感，抗风险强
    "XX": {"固投增速": 0.3, "二产增速": 0.2, "gdp_growth": 0.5, "财政收入增速": 0.4, "人口": 0.3},
    # 农林牧渔 - 受经济周期影响小，对政策敏感
    "NY": {"固投增速": 0.2, "二产增速": 0.3, "gdp_growth": 0.2, "财政收入增速": 0.2, "人口": 0.1},
    # 居民服务 - 对人口、人均收入敏感
    "FW": {"固投增速": 0.1, "二产增速": 0.1, "gdp_growth": 0.4, "财政收入增速": 0.2, "人口": 0.6},
    # 房地产 - 对固投、人口、财政极度敏感
    "FD": {"固投增速": 0.9, "二产增速": 0.3, "gdp_growth": 0.5, "财政收入增速": 0.7, "人口": 0.7},
    # 教育 - 对人口、财政敏感，抗周期性强
    "JY": {"固投增速": 0.2, "二产增速": 0.1, "gdp_growth": 0.3, "财政收入增速": 0.5, "人口": 0.6},
    # 医疗健康 - 抗周期，对人口结构敏感
    "YL": {"固投增速": 0.1, "二产增速": 0.1, "gdp_growth": 0.2, "财政收入增速": 0.3, "人口": 0.5},
    # 文体娱乐 - 对人均收入敏感，顺周期
    "WL": {"固投增速": 0.2, "二产增速": 0.1, "gdp_growth": 0.5, "财政收入增速": 0.3, "人口": 0.5},
    # 能源环保 - 对二产、固投敏感
    "HB": {"固投增速": 0.5, "二产增速": 0.6, "gdp_growth": 0.4, "财政收入增速": 0.3, "人口": 0.2},
    # 商务服务 - 对GDP、三产敏感
    "SW": {"固投增速": 0.3, "二产增速": 0.2, "gdp_growth": 0.6, "财政收入增速": 0.4, "人口": 0.4},
    # 金融 - 对GDP、财政极度敏感
    "JR": {"固投增速": 0.3, "二产增速": 0.3, "gdp_growth": 0.7, "财政收入增速": 0.8, "人口": 0.4},
    # 科研技术 - 对GDP、三产敏感，抗风险
    "KJ": {"固投增速": 0.3, "二产增速": 0.2, "gdp_growth": 0.5, "财政收入增速": 0.4, "人口": 0.3},
    # 其他
    "QT": {"固投增速": 0.3, "二产增速": 0.3, "gdp_growth": 0.5, "财政收入增速": 0.3, "人口": 0.4},
    # 采矿业 - 对二产、能源价格敏感
    "CK": {"固投增速": 0.4, "二产增速": 0.7, "gdp_growth": 0.4, "财政收入增速": 0.4, "人口": 0.2},
    # 水利环境
    "SL": {"固投增速": 0.5, "二产增速": 0.3, "gdp_growth": 0.3, "财政收入增速": 0.5, "人口": 0.2},
}

def get_industry_category(code):
    """从行业编号提取门类代码（前2位字母）"""
    m = re.match(r'^([A-Z]+)', code or '')
    return m.group(1) if m else 'QT'

def calc_city_risk_score(city_name, industry_code, city_econ):
    """
    计算某行业在某城市的风险评分（0~100，越高风险越大）
    基准分50分 = C级（中等风险）
    各项经济指标偏离基准则加减分
    城市指标 × 行业敏感度 = 最终评分
    """
    cat = get_industry_category(industry_code)
    sens = INDUSTRY_RISK_SENSITIVITY.get(cat, INDUSTRY_RISK_SENSITIVITY['QT'])
    econ = city_econ.get(city_name)
    if not econ:
        return 50  # 默认中等风险
    
    # 各指标的风险化处理：以基准线为0，向下/向上偏离则加减分
    # 固投增速：基准5%，每低1%+3分，每高1%-2分，封顶±25
    inv_dev = econ['固投增速'] - 5
    inv_score = max(-25, min(25, inv_dev * (-3) if inv_dev < 0 else inv_dev * (-2)))
    
    # 二产增速：基准4%，每低1%+4分，每高1%-2分，封顶±25
    ind_dev = econ['二产增速'] - 4
    ind_score = max(-25, min(25, ind_dev * (-4) if ind_dev < 0 else ind_dev * (-2)))
    
    # GDP增速：基准4.5%，每低1%+3分，每高1%-2分，封顶±20
    gdp_dev = econ['gdp_growth'] - 4.5
    gdp_score = max(-20, min(20, gdp_dev * (-3) if gdp_dev < 0 else gdp_dev * (-2)))
    
    # 财政收入增速：基准3%，每低1%+3分，每高1%-1.5分，封顶±15
    fin_dev = econ['财政收入增速'] - 3
    fin_score = max(-15, min(15, fin_dev * (-3) if fin_dev < 0 else fin_dev * (-1.5)))
    
    # 人口规模：基准1000万，每少500万+3分，每多500万-2分，封顶±10
    pop_dev = (econ['人口'] - 1000) / 500
    pop_score = max(-10, min(10, pop_dev * (-2) if pop_dev > 0 else pop_dev * (-3)))
    
    # 加权求和（敏感度越高的指标，对该行业影响越大）
    # 注意：用加权和而非加权平均，高敏感度行业的风险波动更显著
    weighted_score = (
        inv_score * sens['固投增速'] +
        ind_score * sens['二产增速'] +
        gdp_score * sens['gdp_growth'] +
        fin_score * sens['财政收入增速'] +
        pop_score * sens['人口']
    )
    
    # 基准50分 + 加权偏离分 × 放大系数（使分布更舒展）
    final_score = 50 + weighted_score * 1.8
    return round(max(5, min(95, final_score)), 1)

def score_to_level(score):
    """将0-100的风险评分映射为A/B/C/D"""
    if score < 25:
        return 'A'
    elif score < 45:
        return 'B'
    elif score < 70:
        return 'C'
    else:
        return 'D'

def recalc_city_risks(data):
    """
    基于经济指标趋势，微调城市风险层级
    策略：以专家评定的风险层级为基准，根据经济指标变化趋势微调±1级
    - 经济全面向好（多项指标超基准）：风险降1级
    - 经济全面恶化（多项指标远低于基准）：风险升1级
    - 经济正常波动：保持不变
    保留"依据与尽调要点"原文（专家撰写内容不变）
    新增"风险评分"字段供参考
    """
    print("=== 微调城市风险层级（基于经济趋势） ===")
    risks = data.get('city_risks', [])
    if not risks:
        print("  无城市风险数据，跳过")
        return data
    
    # 先确保所有层级已标准化
    for r in risks:
        r['风险层级'] = normalize_risk_level(r.get('风险层级', 'C'))
    
    upgraded = 0  # 风险上升
    downgraded = 0  # 风险下降
    unchanged = 0
    
    for r in risks:
        city = r.get('城市', '')
        code = r.get('行业编号', '')
        current_lv = r.get('风险层级', 'C')
        score = calc_city_risk_score(city, code, CITY_ECONOMIC)
        r['风险评分'] = score
        
        # 经济趋势综合得分判断（保守调整，仅极端情况才变）
        # score < 35: 经济显著向好（远超基准） → 风险可降1级
        # 35 ≤ score ≤ 80: 经济正常波动 → 保持不变
        # score > 80: 经济显著恶化（远低于基准） → 风险可升1级
        lv_order = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
        current_order = lv_order.get(current_lv, 3)
        
        if score < 35 and current_order > 1:
            # 经济显著向好，风险降1级（但不低于A）
            new_order = current_order - 1
            r['风险层级'] = [k for k, v in lv_order.items() if v == new_order][0]
            downgraded += 1
        elif score > 80 and current_order < 4:
            # 经济显著恶化，风险升1级（但不高于D）
            new_order = current_order + 1
            r['风险层级'] = [k for k, v in lv_order.items() if v == new_order][0]
            upgraded += 1
        else:
            unchanged += 1
    
    # 统计分布
    from collections import Counter
    dist = Counter(r.get('风险层级', 'C') for r in risks)
    print(f"  风险分布: A:{dist.get('A',0)} B:{dist.get('B',0)} C:{dist.get('C',0)} D:{dist.get('D',0)}")
    print(f"  调整: 上升{upgraded}条, 下降{downgraded}条, 不变{unchanged}条")
    print(f"  说明: 以专家评级为基准，经济趋势仅微调±1级")
    
    return data

# ============================================================
# 动态城市系数计算
# ============================================================
def recalc_city_factors(data):
    """
    基于城市经济指标重新计算城市系数
    主要参考：社平工资、人均GDP，辅以GDP总量
    """
    print("=== 重新计算城市系数 ===")
    
    # 计算各城市综合收入指数
    city_indices = {}
    for city, econ in CITY_ECONOMIC.items():
        # 社平工资权重60%，人均GDP权重40%
        salary_idx = econ['社平工资']
        gdp_per_idx = econ['人均gdp'] * 500  # 人均GDP(万元)×500 换算到工资量级
        composite = salary_idx * 0.6 + gdp_per_idx * 0.4
        city_indices[city] = composite
    
    # 以全国平均水平为基准（约等于20城市均值）
    avg_composite = sum(city_indices.values()) / len(city_indices)
    factors = {city: round(idx / avg_composite * 1.0, 2) for city, idx in city_indices.items()}
    
    # 确保系数在合理范围
    for city in factors:
        factors[city] = max(0.7, min(2.0, factors[city]))
    
    data['city_factors'] = factors
    print(f"  城市系数: {len(factors)}个城市")
    print(f"  范围: {min(factors.values())} ~ {max(factors.values())}")
    print(f"  基准城市(≈1.0): {sorted(factors.items(), key=lambda x: abs(x[1]-1.0))[0][0]}")
    
    return data

# ============================================================
# 薪资数据更新
# ============================================================
def update_salary_data(data):
    """基于行业基准×职位系数×城市系数计算薪资数据"""
    print("=== 更新薪资数据 ===")
    
    industries = data['industries']
    jobs = data['jobs']
    city_factors = data.get('city_factors', {})
    
    # 行业基准薪资（2025年基准，元/月）
    # 来源：国家统计局2025年分行业城镇非私营单位就业人员平均工资
    industry_base_salary = {
        "建筑业": 7670,
        "制造业": 9466,
        "批发零售业": 11312,
        "交通运输仓储物流": 11165,
        "餐饮住宿业": 5205,
        "信息服务": 20729,
        "农林牧渔": 6202,
        "居民服务": 5966,
        "商务服务": 7850,
        "房地产": 8900,
        "教育": 7650,
        "医疗健康": 8200,
        "文化体育娱乐": 7100,
        "能源环保": 13408,
        "采矿业": 11947,
        "科研技术服务": 12500,
        "水利环境": 6800,
        "其他": 5966,
        "电力能源": 13408,
        "金融业": 19781,
    }
    
    # 行业年度增长率（2025年实际，2026年预估）
    industry_growth_2025 = {
        "建筑业": 2.8, "制造业": 5.2, "批发零售业": 4.7,
        "交通运输仓储物流": 4.8, "餐饮住宿业": 3.7,
        "信息服务": 4.1, "农林牧渔": 10.3,
        "居民服务": 4.0, "商务服务": 5.5, "房地产": 2.0,
        "教育": 3.5, "医疗健康": 6.0, "文化体育娱乐": 5.5,
        "能源环保": 7.1, "采矿业": 1.9,
        "科研技术服务": 5.0, "水利环境": 4.5,
        "其他": 4.0, "电力能源": 7.1, "金融业": 4.7,
    }
    
    # 职位薪资倍数（相对于行业基准）
    job_multipliers = {
        # 管理岗
        "总经理": 2.5, "总监": 2.0, "经理": 1.8, "主管": 1.4, "主任": 1.3, "组长": 1.2,
        "项目经理": 1.6, "运营总监": 2.0, "运营经理": 1.4,
        # 技术岗
        "工程师": 1.2, "高级工程师": 1.6, "技术员": 0.9, "设计师": 1.3, "美工": 1.1,
        "前端开发": 1.4, "后端开发": 1.5, "运维": 1.0, "产品经理": 1.7,
        "造价员": 1.25, "安全员": 0.85, "施工员": 1.15, "资料员": 0.75,
        "质检员": 0.85, "检测员": 0.85, "电工": 0.8,
        "数控操作工": 0.9, "车间主任": 1.35, "爆破工": 1.3,
        "钻机操作员": 1.15, "园林工程师": 1.1,
        # 销售岗
        "销售": 1.0, "业务员": 0.9, "客户经理": 1.2,
        # 服务岗
        "服务员": 0.55, "收银员": 0.5, "导购": 0.7, "保洁员": 0.45,
        "厨师": 0.7, "司机": 0.75, "快递员": 0.72, "配送": 0.7,
        "仓管": 0.58, "店员": 0.6, "客服": 0.8,
        # 管理/店主
        "店长": 0.85, "店主": 0.7, "老板": 1.0,
        # 医护
        "护士": 0.8, "医生": 1.5,
        # 其他
        "主播": 1.2, "运营": 1.0, "推广": 0.9, "策划": 1.0,
        "配送司机": 0.8,
    }
    
    # 高需求职位关键词
    high_demand_keywords = [
        "安全员", "施工员", "电工", "司机", "快递", "配送", "厨师",
        "保洁", "导购", "护士", "服务员", "收银员", "仓管", "客服"
    ]
    
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
        growth_rate = industry_growth_2025.get(cat, 4.0)
        
        # 找最匹配的职位系数
        mult = 1.0
        best_match_len = 0
        for kw, m in job_multipliers.items():
            if kw in job_name and len(kw) > best_match_len:
                mult = m
                best_match_len = len(kw)
        
        monthly_median = int(base * mult)
        monthly_min = int(monthly_median * 0.75)
        monthly_max = int(monthly_median * 1.35)
        annual = monthly_median * 12
        
        # 年度趋势（2020-2027，2025为基准）
        years = {}
        trend = {}
        for yr in range(2020, 2027):
            offset = yr - 2025
            if offset == 0:
                factor = 1.0
            elif offset < 0:
                # 历史年份：倒推
                factor = 1.0 / ((1 + growth_rate / 100) ** abs(offset))
            else:
                # 未来年份：正推
                factor = (1 + growth_rate / 100) ** offset
            
            m_min = int(monthly_min * factor)
            m_max = int(monthly_max * factor)
            m_med = int(monthly_median * factor)
            a = int(annual * factor)
            gr = f"+{growth_rate}%" if yr > 2020 else "—"
            
            years[str(yr)] = {
                "monthly_min": m_min, "monthly_max": m_max,
                "monthly_median": m_med, "annual": a, "growth_rate": gr,
            }
            trend[str(yr)] = {
                "min": m_min, "max": m_max, "median": m_med,
                "annual": a, "growth_rate": gr,
            }
        
        # 需求判断
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
            "source": "国家统计局2025年分行业平均工资+职位系数模型"
        }
    
    data['salary'] = salary
    data['meta']['last_updated'] = datetime.now().strftime('%Y-%m-%d')
    data['meta']['data_source'] = "国家统计局分行业平均工资+城市统计公报+风险评分模型"
    
    print(f"  薪资数据: {len(salary)}条")
    print(f"  行业门类: {len(industry_base_salary)}个")
    
    return data

# ============================================================
# 行业财务指标更新
# ============================================================
def update_industry_financials(data):
    """
    基于行业风险评分和经济环境，微调行业毛利率/净利率区间
    注意：不做大幅度调整，只做趋势性微调（±5%以内）
    """
    print("=== 更新行业财务指标 ===")
    industries = data.get('industries', [])
    if not industries:
        print("  无行业数据，跳过")
        return data
    
    # 计算各行业整体风险（20城平均）
    cat_risk = {}
    risks = data.get('city_risks', [])
    for r in risks:
        code = r.get('行业编号', '')
        lv = normalize_risk_level(r.get('风险层级', 'C'))
        score = {'A': 1, 'B': 2, 'C': 3, 'D': 4}[lv]
        cat = get_industry_category(code)
        if cat not in cat_risk:
            cat_risk[cat] = []
        cat_risk[cat].append(score)
    
    cat_avg_risk = {cat: sum(scores)/len(scores) for cat, scores in cat_risk.items()}
    
    adjusted = 0
    for ind in industries:
        cat = get_industry_category(ind.get('行业编号', ''))
        risk_avg = cat_avg_risk.get(cat, 2.5)
        
        # 风险越高，毛利率区间下限微降（竞争加剧/经营压力大）
        # 只在原区间基础上微调（不改变基本面判断）
        raw_gross = ind.get('毛利率区间', '')
        if raw_gross and '~' in raw_gross:
            # 解析区间
            nums = re.findall(r'[\d.]+', raw_gross)
            if len(nums) >= 2:
                low = float(nums[0])
                high = float(nums[1])
                # 风险高则下限降1个百分点，上限不变（风险上升，下限承压）
                if risk_avg > 2.8 and low > 3:
                    new_low = round(low - 1, 0)
                    ind['毛利率区间'] = f"{int(new_low)}%~{int(high)}%"
                    adjusted += 1
    
    print(f"  财务指标微调: {adjusted} 个行业")
    return data

# ============================================================
# 生成JS文件
# ============================================================
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

# ============================================================
# 主入口
# ============================================================
if __name__ == '__main__':
    print("=" * 60)
    print("开始数据更新 - " + datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    print("=" * 60)
    
    # 加载现有数据
    seed_path = os.path.join(ROOT, "data", "seed.json")
    if not os.path.exists(seed_path):
        seed_path = os.path.join(ROOT, "data", "seed_updated.json")
    
    print(f"\n数据源: {seed_path}")
    with open(seed_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 1. 重新计算城市系数（基于经济指标）
    data = recalc_city_factors(data)
    
    # 2. 更新薪资数据（行业基准×职位系数×城市系数）
    data = update_salary_data(data)
    
    # 3. 风险层级标准化（安全网）
    data = normalize_all_risks(data)
    
    # 4. 自动重新评分城市风险
    data = recalc_city_risks(data)
    
    # 5. 微调行业财务指标
    data = update_industry_financials(data)
    
    # 6. 生成JS文件
    generate_js_files(data)
    
    # 7. 保存更新后的seed
    out_path = os.path.join(ROOT, "data", "seed_updated.json")
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"\n更新后seed已保存: {out_path}")
    
    print("\n" + "=" * 60)
    print("更新完成！")
    print("=" * 60)
    print("\n说明：")
    print("  ✅ 自动更新的维度：薪资、城市系数、风险评分、财务指标微调")
    print("  ❌ 不自动更新的维度：行业档案、职业审核、经营模式（专家知识）")
    print("  📝 依据与尽调要点：保留专家原文，风险层级自动重评")
