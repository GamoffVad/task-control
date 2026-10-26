from pathlib import Path
import json
import re
from PIL import Image, ImageDraw
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[3]
TMP = ROOT / 'tmp/pdfs/release-report-6.16.0'
PDF = ROOT / 'output/pdf/Task_Control_Report_v6.16.0_2026-10-26.pdf'
reader = PdfReader(PDF)
assert len(reader.pages) == 9
texts, links = [], []
for index, page in enumerate(reader.pages, 1):
    text = page.extract_text()
    assert f'{index:02} / 09' in text
    texts.append(text)
    for annotation in page.get('/Annots', []):
        action = annotation.get_object().get('/A', {})
        if action.get('/URI'):
            links.append(str(action['/URI']))
text = '\n'.join(texts)
assert set(re.findall(r'(?<!\d)6\.\d+\.\d+(?!\d)',text)) == {'6.16.0'}
assert all(value in text for value in ['554', '19', 'manages_parent', '01.01.2026', 'Руководство', 'SQL Server'])
assert len(links) == 3
sheet = Image.new('RGB', (900,1290),'#DDE3E8')
draw = ImageDraw.Draw(sheet)
for i, path in enumerate(sorted(TMP.glob('page-*.png'))):
    im = Image.open(path).convert('RGB')
    im.thumbnail((282,402))
    x,y=(i%3)*300,(i//3)*430
    sheet.paste(im,(x+(300-im.width)//2,y+5))
    draw.text((x+12,y+412),f'{i+1:02} / 09',fill='#193652')
sheet.save(TMP/'contact-sheet.png')
print(json.dumps({'pages':len(reader.pages),'bytes':PDF.stat().st_size,'links':links},ensure_ascii=False,indent=2))
