"""
从seed_updated.json生成data1-6.js文件
布局：
  data1.js: meta + industries + modes + cities
  data2.js: jobs 前半
  data3.js: jobs 后半
  data4.js: city_risks 前半
  data5.js: city_risks 后半
  data6.js: salary + city_factors
"""
import json, os, re

ROOT = r"C:\Users\o1049273225\Desktop\小微行业知识库V3_网页版"
SEED = os.path.join(ROOT, "data", "seed_updated.json")
OUT = os.path.join(ROOT, "public", "static")
DATA_DIR = os.path.join(ROOT, "data")
os.makedirs(OUT, exist_ok=True)

with open(SEED, 'r', encoding='utf-8') as f:
    data = json.load(f)

industries = data['industries']
jobs = data['jobs']
modes = data['modes']
cities = data['cities']
city_risks = data['city_risks']
meta = data.get('meta', {})

# 读取从GitHub下载的原始salary和city_factors
salary = {}
city_factors = {}

for fn, key in [("orig_data5.js", "salary"), ("orig_data6.js", "city_factors")]:
    fp = os.path.join(DATA_DIR, fn)
    if os.path.exists(fp):
        with open(fp, 'r', encoding='utf-8') as f:
            obj = json.load(f)
            if key in obj:
                if key == "salary":
                    salary = obj[key]
                else:
                    city_factors = obj[key]
                print(f"从 {fn} 读取 {key}: {len(obj[key])}条")
    else:
        print(f"警告: {fn} 不存在")

# 生成data1.js: meta + industries + modes + cities
d1 = {"meta": meta, "industries": industries, "modes": modes, "cities": cities}
with open(os.path.join(OUT, "data1.js"), 'w', encoding='utf-8') as f:
    f.write("window.XWK_DATA_1 = " + json.dumps(d1, ensure_ascii=False) + ";\n")

# data2.js + data3.js: jobs 拆分两半
mid = len(jobs) // 2
d2 = {"jobs": jobs[:mid]}
with open(os.path.join(OUT, "data2.js"), 'w', encoding='utf-8') as f:
    f.write("window.XWK_DATA_2 = " + json.dumps(d2, ensure_ascii=False) + ";\n")

d3 = {"jobs": jobs[mid:]}
with open(os.path.join(OUT, "data3.js"), 'w', encoding='utf-8') as f:
    f.write("window.XWK_DATA_3 = " + json.dumps(d3, ensure_ascii=False) + ";\n")

# data4.js + data5.js: city_risks 拆分两半
mid_r = len(city_risks) // 2
d4 = {"city_risks": city_risks[:mid_r]}
with open(os.path.join(OUT, "data4.js"), 'w', encoding='utf-8') as f:
    f.write("window.XWK_DATA_4 = " + json.dumps(d4, ensure_ascii=False) + ";\n")

d5 = {"city_risks": city_risks[mid_r:]}
with open(os.path.join(OUT, "data5.js"), 'w', encoding='utf-8') as f:
    f.write("window.XWK_DATA_5 = " + json.dumps(d5, ensure_ascii=False) + ";\n")

# data6.js: salary + city_factors
d6 = {"salary": salary, "city_factors": city_factors}
with open(os.path.join(OUT, "data6.js"), 'w', encoding='utf-8') as f:
    f.write("window.XWK_DATA_6 = " + json.dumps(d6, ensure_ascii=False) + ";\n")

# 检查文件大小
total = 0
for name in ["data1.js", "data2.js", "data3.js", "data4.js", "data5.js", "data6.js"]:
    size = os.path.getsize(os.path.join(OUT, name))
    total += size
    flag = " *** OVER 1MB ***" if size > 1048576 else ""
    print(f"{name}: {size/1024:.0f}KB{flag}")

print(f"\n总计: {total/1024:.0f}KB")
print(f"行业{len(industries)} 职业{len(jobs)} 模式{len(modes)} 城市风险{len(city_risks)} 薪资{len(salary)} 城市系数{len(city_factors)}")
