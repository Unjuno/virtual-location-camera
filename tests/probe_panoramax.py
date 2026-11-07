"""One-time non-mutating probe of Panoramax's public STAC API schema."""
import json
import urllib.request
import urllib.parse

coords=[
  ("Paris",2.292,48.857,2.298,48.862),
  ("Lyon",4.828,45.759,4.835,45.766),
  ("Tokyo",139.698,35.656,139.703,35.662)
]
for name,west,south,east,north in coords:
  query=urllib.parse.urlencode({"bbox":f"{west},{south},{east},{north}","limit":3})
  url="https://api.panoramax.xyz/api/search?"+query
  try:
    req=urllib.request.Request(url,headers={"User-Agent":"virtual-location-camera/1.0 (https://github.com/Unjuno/virtual-location-camera)","Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=10) as r:
      data=json.load(r)
      print("PANORAMAX",name,"HTTP",r.status,"type",data.get("type"),"features",len(data.get("features",[])))
      for feat in data.get("features",[])[:1]:
        print("SCHEMA",json.dumps(feat,ensure_ascii=False)[:5000])
  except Exception as e:
    print("PANORAMAX",name,"FAIL",type(e).__name__,str(e)[:300])
