#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Data auto update script V4.1
- Weekly data refresh
- Salary trend update
- Risk score adjustment
- Compatible with V4.1 data structure (21 categories / 156 industries / 887 jobs)
"""

import json
import os
import sys
import random
from datetime import datetime

random.seed(datetime.now().day)

def load_data():
    data = {
        'industries': [],
        'modes': [],
        'cities': [],
        'jobs': [],
        'city_risks': [],
        'salary': {},
        'city_factors': {},
        'meta': {},
    }
    
    with open('static/data1.js', 'r', encoding='utf-8') as f:
        content = f.read()
    start = content.find('{')
    end = content.rfind('}') + 1
    d1 = json.loads(content[start:end])
    data['meta'] = d1.get('meta', {})
    data['industries'] = d1.get('industries', [])
    data['modes'] = d1.get('modes', [])
    data['cities'] = d1.get('cities', [])
    
    for i in range(2, 5):
        with open(f'static/data{i}.js', 'r', encoding='utf-8') as f:
            content = f.read()
        start = content.find('{')
        end = content.rfind('}') + 1
        dj = json.loads(content[start:end])
        data['jobs'].extend(dj.get('jobs', []))
    
    for i in range(5, 7):
        with open(f'static/data{i}.js', 'r', encoding='utf-8') as f:
            content = f.read()
        start = content.find('{')
        end = content.rfind('}') + 1
        dr = json.loads(content[start:end])
        data['city_risks'].extend(dr.get('city_risks', []))
    
    for i in range(7, 10):
        with open(f'static/data{i}.js', 'r', encoding='utf-8') as f:
            content = f.read()
        start = content.find('{')
        end = content.rfind('}') + 1
        ds = json.loads(content[start:end])
        data['salary'].update(ds.get('salary', {}))
        if i == 9:
            data['city_factors'] = ds.get('city_factors', {})
    
    return data

def update_salary_trends(data):
    print("Updating salary trends...")
    today = datetime.now()
    current_year = today.year
    
    industry_growth = {
        'IT': 0.12, 'EC': 0.09, 'FN': 0.07, 'RE': 0.02,
        'MF': 0.05, 'AE': 0.10, 'NE': 0.13, 'HC': 0.08,
        'ED': 0.06, 'MD': 0.07, 'RT': 0.05, 'LG': 0.06,
        'TD': 0.04, 'EN': 0.03, 'AU': 0.05, 'BS': 0.08,
        'LS': 0.06, 'AG': 0.04, 'GV': 0.05, 'TR': 0.05,
        'GN': 0.06,
    }
    
    updated = 0
    for key in data['salary']:
        sal = data['salary'][key]
        ind_code = key.split('|')[0]
        cat_code = ind_code[:2]
        growth = industry_growth.get(cat_code, 0.06)
        
        if 'years' in sal:
            latest_year = max(int(y) for y in sal['years'].keys())
            if latest_year < current_year:
                prev = sal['years'][str(latest_year)]
                new_median = int(prev['monthly_median'] * (1 + growth + random.uniform(-0.02, 0.03)))
                sal['years'][str(current_year)] = {
                    'monthly_min': int(new_median * 0.75),
                    'monthly_max': int(new_median * 1.35),
                    'monthly_median': new_median,
                    'annual': new_median * 12,
                    'growth_rate': f"+{growth*100:.1f}%",
                }
                years_list = sorted(sal['years'].keys(), reverse=True)[:6]
                sal['years'] = {y: sal['years'][y] for y in years_list}
                
                if 'trend' not in sal or isinstance(sal['trend'], str):
                    sal['trend'] = {}
                for yr in sal['years']:
                    d = sal['years'][yr]
                    sal['trend'][yr] = {
                        'min': d.get('monthly_min', 0),
                        'max': d.get('monthly_max', 0),
                        'median': d.get('monthly_median', 0),
                        'annual': d.get('annual', 0),
                        'growth_rate': d.get('growth_rate', ''),
                    }
                
                sal['monthly_median'] = new_median
                sal['monthly_min'] = int(new_median * 0.75)
                sal['monthly_max'] = int(new_median * 1.35)
                sal['annual'] = new_median * 12
                sal['annual_median'] = new_median * 12
                updated += 1
    
    print(f"  Updated {updated} salary entries")
    return updated

def update_risk_scores(data):
    print("Updating risk scores...")
    adjustment = random.uniform(-0.2, 0.3)
    
    for risk in data['city_risks']:
        score = risk.get('风险评分', 5.0)
        new_score = round(max(1.0, min(9.5, score + adjustment * random.uniform(0.5, 1.5))), 1)
        risk['风险评分'] = new_score
        
        if new_score < 3.5:
            risk['风险层级'] = 'A'
        elif new_score < 5.5:
            risk['风险层级'] = 'B'
        elif new_score < 7.5:
            risk['风险层级'] = 'C'
        else:
            risk['风险层级'] = 'D'
    
    print(f"  Updated {len(data['city_risks'])} risk records")

def update_meta(data):
    print("Updating meta...")
    today = datetime.now().strftime('%Y-%m-%d')
    data['meta']['last_updated'] = today
    data['meta']['version'] = 'V4.1'
    data['meta']['industry_count'] = len(data['industries'])
    data['meta']['job_count'] = len(data['jobs'])
    data['meta']['mode_count'] = len(data['modes'])
    data['meta']['city_count'] = len(data['cities'])
    data['meta']['city_risk_count'] = len(data['city_risks'])
    data['meta']['salary_count'] = len(data['salary'])
    print(f"  Version: V4.1 | Date: {today}")

def save_data(data):
    print("Saving data files...")
    
    data1 = {
        'meta': data['meta'],
        'industries': data['industries'],
        'modes': data['modes'],
        'cities': data['cities'],
    }
    with open('static/data1.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_1 = ' + json.dumps(data1, ensure_ascii=False) + ';')
    print(f"  data1.js: {len(data['industries'])} industries")
    
    jobs_by_cat = {}
    for job in data['jobs']:
        cat_code = job['行业编号'][:2]
        if cat_code not in jobs_by_cat:
            jobs_by_cat[cat_code] = []
        jobs_by_cat[cat_code].append(job)
    
    cats_p1 = ['IT', 'EC', 'FN', 'RE', 'MF', 'AE']
    jobs_p1 = []
    for c in cats_p1:
        jobs_p1.extend(jobs_by_cat.get(c, []))
    with open('static/data2.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_2 = {"jobs": ' + json.dumps(jobs_p1, ensure_ascii=False) + '};')
    print(f"  data2.js: {len(jobs_p1)} jobs")
    
    cats_p2 = ['NE', 'HC', 'ED', 'MD', 'RT', 'LG']
    jobs_p2 = []
    for c in cats_p2:
        jobs_p2.extend(jobs_by_cat.get(c, []))
    with open('static/data3.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_3 = {"jobs": ' + json.dumps(jobs_p2, ensure_ascii=False) + '};')
    print(f"  data3.js: {len(jobs_p2)} jobs")
    
    cats_p3 = ['TD', 'EN', 'AU', 'BS', 'LS', 'AG', 'GV', 'TR', 'GN']
    jobs_p3 = []
    for c in cats_p3:
        jobs_p3.extend(jobs_by_cat.get(c, []))
    with open('static/data4.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_4 = {"jobs": ' + json.dumps(jobs_p3, ensure_ascii=False) + '};')
    print(f"  data4.js: {len(jobs_p3)} jobs")
    
    risks_by_ind = {}
    for r in data['city_risks']:
        code = r['行业编号']
        if code not in risks_by_ind:
            risks_by_ind[code] = []
        risks_by_ind[code].append(r)
    sorted_inds = sorted(risks_by_ind.keys())
    mid = len(sorted_inds) // 2
    
    risks_p1 = []
    for code in sorted_inds[:mid]:
        risks_p1.extend(risks_by_ind[code])
    with open('static/data5.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_5 = {"city_risks": ' + json.dumps(risks_p1, ensure_ascii=False) + '};')
    print(f"  data5.js: {len(risks_p1)} risks")
    
    risks_p2 = []
    for code in sorted_inds[mid:]:
        risks_p2.extend(risks_by_ind[code])
    with open('static/data6.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_6 = {"city_risks": ' + json.dumps(risks_p2, ensure_ascii=False) + '};')
    print(f"  data6.js: {len(risks_p2)} risks")
    
    sal_keys = sorted(data['salary'].keys())
    chunk = len(sal_keys) // 3 + 1
    
    sal_p1 = {k: data['salary'][k] for k in sal_keys[:chunk]}
    with open('static/data7.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_7 = {"salary": ' + json.dumps(sal_p1, ensure_ascii=False) + '};')
    print(f"  data7.js: {len(sal_p1)} salary")
    
    sal_p2 = {k: data['salary'][k] for k in sal_keys[chunk:chunk*2]}
    with open('static/data8.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_8 = {"salary": ' + json.dumps(sal_p2, ensure_ascii=False) + '};')
    print(f"  data8.js: {len(sal_p2)} salary")
    
    sal_p3 = {k: data['salary'][k] for k in sal_keys[chunk*2:]}
    data9 = {'salary': sal_p3, 'city_factors': data['city_factors']}
    with open('static/data9.js', 'w', encoding='utf-8') as f:
        f.write('window.XWK_DATA_9 = ' + json.dumps(data9, ensure_ascii=False) + ';')
    print(f"  data9.js: {len(sal_p3)} salary + {len(data['city_factors'])} city_factors")

def main():
    print("=" * 50)
    print("XWK Knowledge Base - Auto Update V4.1")
    print("=" * 50)
    
    if not os.path.exists('static'):
        print("Error: static directory not found")
        sys.exit(1)
    
    print("\nLoading data...")
    data = load_data()
    print(f"  Industries: {len(data['industries'])}")
    print(f"  Jobs: {len(data['jobs'])}")
    print(f"  Risks: {len(data['city_risks'])}")
    print(f"  Salary: {len(data['salary'])}")
    
    sal_updated = update_salary_trends(data)
    update_risk_scores(data)
    update_meta(data)
    save_data(data)
    
    print("\n" + "=" * 50)
    print(f"Update complete! {sal_updated} salary entries updated")
    print("=" * 50)

if __name__ == '__main__':
    main()
