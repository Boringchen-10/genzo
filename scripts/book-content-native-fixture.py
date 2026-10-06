"""Synthetic fixture for an explicitly isolated, stopped Book Content QA profile."""
from pathlib import Path
import hashlib, json, re, sqlite3, sys, zipfile

logical_root = Path(sys.argv[1]).absolute()
root = logical_root.resolve()
if not re.fullmatch(r'com\.genzo\.desktop\.book-content-qa-[a-f0-9]{32}', root.name):
    raise SystemExit('Refusing a non-isolated application directory')
if not root.joinpath('genzo.db').is_file():
    raise SystemExit('Start and stop the unique QA application before seeding')
if sys.platform == 'win32' and not str(root).startswith('\\\\?\\'):
    root = Path('\\\\?\\' + str(root))
db = sqlite3.connect(root / 'genzo.db')
if db.execute('select count(*) from works').fetchone()[0]:
    if '--resume' not in sys.argv or db.execute("select count(*) from works where title not like '合成测试%'").fetchone()[0] or db.execute('select count(*) from media_files').fetchone()[0]:
        raise SystemExit('Refusing a nonempty nonsynthetic library')
now='2026-10-05T00:00:00Z'; expiry='2099-01-01T00:00:00Z'
host='https://api.copy202601.com'; hot='https://mapi.hotmangasg.com'
def cache(provider, url, params, data):
    key='v1:'+url+':'+json.dumps(params,ensure_ascii=False,separators=(',',':'))
    db.execute('insert or replace into metadata_cache(provider,cache_key,response_json,fetched_at,expires_at) values(?,?,?,?,?)', (provider,key,json.dumps(data,ensure_ascii=False),now,expiry))
def item(book,kind):
    return dict(pathWord=book,title='合成测试'+('轻小说' if kind=='novel' else '漫画'),coverUrl=None,authors=['合成作者'],tags=[],summary='用于本机 IPC 验证的合成资料。',status='已完结',updatedAt='2026-10-05',latestChapter='测试卷',localWorkId=None,favorite=False)
for kind, provider, book, entry in [('novel','copynovel','qa-novel','v1'),('comic','copymanga','qa-comic','c1')]:
    current=item(book,kind)
    cache(provider,host+'/api/v3/'+('books' if kind=='novel' else 'comics'), [('limit','24'),('offset','0'),('ordering','-popular')],dict(items=[current],total=1,page=1,stale=False))
    detail=dict(item=current,aliases=[],chapterCount=1,stale=False)
    if kind=='novel':
        cache(provider,host+'/api/v3/book/'+book,[('in_mainland','true')],detail)
        cache(provider,host+'/api/v3/theme/book/count',[('free_type','1'),('limit','500'),('offset','0')],[])
        url=host+'/api/v3/book/'+book+'/volumes';params=[];groups=[];group=''
    else:
        cache(provider,hot+'/api/v3/comic2/'+book,[('platform','3')],detail)
        cache('copy-reading',hot+'/api/v3/comic2/'+book,[],{'comic':{'path_word':book},'groups':{'default':{'name':'默认','count':1}}})
        url=hot+'/api/v3/comic/'+book+'/group/default/chapters';params=[('limit','100'),('offset','0')];group='default';groups=[{'id':'default','title':'默认'}]
    cache('copy-reading',url,params,dict(entries=[dict(id=entry,title='合成测试章卷',order=0,count=1)],total=1,offset=0,group=group,groups=groups,stale=False))
    digest=hashlib.sha256((kind+'\n'+book+'\n'+entry).encode()).hexdigest()
    directory=root/'reading-cache'/'v1'/digest/'complete-001-fixture'
    directory.mkdir(parents=True, exist_ok='--resume' in sys.argv)
    filename='volume.epub' if kind=='novel' else 'chapter.cbz'
    with zipfile.ZipFile(directory/filename,'w') as z:
        if kind=='novel':
            z.writestr('mimetype','application/epub+zip')
            z.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
            z.writestr('content.opf','<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>合成测试卷</dc:title></metadata><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>')
            z.writestr('chapter.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><head><title>测试</title></head><body><p>合成测试正文</p></body></html>')
        else:
            import base64
            z.writestr('0001.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
    data=(directory/filename).read_bytes()
    manifest=dict(version=1,kind=kind,bookId=book,entryId=entry,title='合成测试章卷',openFile=filename,files=[dict(name=filename,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data))],cachedAt=now)
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
reader=root/'capture-reader.mjs'; marker=logical_root/'reader-result.json'
reader.write_text('import fs from "node:fs";const [file,title]=process.argv.slice(2);fs.writeFileSync('+json.dumps(str(marker))+',JSON.stringify({file,title,exists:fs.existsSync(file)}));',encoding='utf-8')
db.execute("insert or replace into external_tools(id,name,executable_path,supported_media_types,arguments_template,is_default,created_at,updated_at) values(?,?,?,?,?,1,?,?)", ('qa-reader','合成阅读器','E:/node.js/node.exe',json.dumps(['novel','comic']),f'"{logical_root / "capture-reader.mjs"}" "{{file}}" "{{title}}"',now,now))
db.commit();db.close()
print('Seeded isolated synthetic metadata/cache/reader fixture')
