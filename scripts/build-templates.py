#!/usr/bin/env python3
"""Dựng 5 mẫu văn bản Word dựng sẵn (templates/builtin/*.docx) bằng python-docx.

Chạy:  python3 scripts/build-templates.py
Ứng dụng Node không chạy script này; chỉ đọc các file .docx đã dựng (được commit kèm).
Mẫu chỉ theo thể thức (khổ giấy, lề, phông, bố cục), nội dung là ô trống {ma_truong}.
"""
import io
import os
import re
import zipfile

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

FONT = 'Times New Roman'
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'templates', 'builtin')

CENTER = WD_ALIGN_PARAGRAPH.CENTER
LEFT = WD_ALIGN_PARAGRAPH.LEFT
JUSTIFY = WD_ALIGN_PARAGRAPH.JUSTIFY

TBLPR_ORDER = ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize',
               'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook',
               'tblCaption', 'tblDescription']
PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
             'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
             'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
             'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
             'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange']


def put_child(parent, tag, order):
    """Thay/thêm phần tử con w:<tag> đúng thứ tự lược đồ OOXML."""
    for old in parent.findall(qn('w:' + tag)):
        parent.remove(old)
    el = OxmlElement('w:' + tag)
    idx = order.index(tag)
    for child in parent:
        name = child.tag.split('}')[-1]
        if name in order and order.index(name) > idx:
            child.addprevious(el)
            return el
    parent.append(el)
    return el


def set_rfonts(rpr):
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.insert(0, rfonts)
    for attr in list(rfonts.attrib):
        if attr.endswith('Theme'):
            del rfonts.attrib[attr]
    for a in ('ascii', 'hAnsi', 'eastAsia', 'cs'):
        rfonts.set(qn('w:' + a), FONT)


def new_document(landscape=False):
    doc = Document()
    # Phông mặc định toàn văn bản (kể cả chữ Việt có dấu, East Asian, complex script).
    defaults = doc.styles.element.find(qn('w:docDefaults'))
    rpr_default = defaults.find(qn('w:rPrDefault')).find(qn('w:rPr'))
    set_rfonts(rpr_default)
    normal = doc.styles['Normal']
    normal.font.name = FONT
    normal.font.size = Pt(14)
    set_rfonts(normal.element.get_or_add_rPr())
    lang = normal.element.get_or_add_rPr().find(qn('w:lang'))
    if lang is None:
        lang = OxmlElement('w:lang')
        normal.element.get_or_add_rPr().append(lang)
    lang.set(qn('w:val'), 'vi-VN')
    pf = normal.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing = 1.0

    sec = doc.sections[0]
    if landscape:
        sec.orientation = WD_ORIENT.LANDSCAPE
        sec.page_width, sec.page_height = Cm(29.7), Cm(21)
        sec.left_margin, sec.right_margin = Cm(2), Cm(1.5)
    else:
        sec.orientation = WD_ORIENT.PORTRAIT
        sec.page_width, sec.page_height = Cm(21), Cm(29.7)
        sec.left_margin, sec.right_margin = Cm(3.5), Cm(2)
    sec.top_margin, sec.bottom_margin = Cm(2), Cm(2)
    sec.header_distance, sec.footer_distance = Cm(1), Cm(1)

    # Dòng kết thúc bằng xuống dòng (Shift+Enter, từ ô nhập nhiều dòng) không bị giãn chữ khi căn đều.
    compat = doc.settings.element.find(qn('w:compat'))
    if compat is None:
        compat = OxmlElement('w:compat')
        doc.settings.element.append(compat)
    compat.insert(0, OxmlElement('w:doNotExpandShiftReturn'))

    cp = doc.core_properties
    cp.author = ''
    cp.last_modified_by = ''
    cp.comments = ''
    return doc


def content_width(doc):
    sec = doc.sections[0]
    return (sec.page_width - sec.left_margin - sec.right_margin) / 360000.0


def add_para(container, text='', align=LEFT, bold=False, italic=False, underline=False, size=None,
             after=0, before=0, line=1.0, first_indent=None, first=False):
    """Thêm một đoạn có đúng một run (ô trống {ma} không bị tách run)."""
    if first:
        p = container.paragraphs[0]
    else:
        p = container.add_paragraph()
    p.alignment = align
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if first_indent is not None:
        pf.first_line_indent = first_indent
    if text:
        r = p.add_run(text)
        if bold:
            r.bold = True
        if italic:
            r.italic = True
        if underline:
            r.underline = True
        if size:
            r.font.size = Pt(size)
    elif size:
        # Cỡ chữ của dấu đoạn (chiều cao dòng trống).
        rpr = p._p.get_or_add_pPr()
        mark = rpr.find(qn('w:rPr'))
        if mark is None:
            mark = put_child(rpr, 'rPr', PPR_ORDER)
        sz = OxmlElement('w:sz')
        sz.set(qn('w:val'), str(int(size * 2)))
        mark.append(sz)
    return p


def short_rule(cell, width_cm, cell_cm):
    """Đường kẻ ngắn căn giữa trong ô (viền dưới của một đoạn trống thụt hai bên)."""
    side = Cm((cell_cm - width_cm) / 2)
    p = add_para(cell, size=2)
    p.paragraph_format.left_indent = side
    p.paragraph_format.right_indent = side
    ppr = p._p.get_or_add_pPr()
    bdr = put_child(ppr, 'pBdr', PPR_ORDER)
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '6')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), 'auto')
    bdr.append(bottom)
    return p


def make_table(doc, widths_cm, rows=1, borders=False):
    table = doc.add_table(rows=rows, cols=len(widths_cm))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    tblpr = table._tbl.tblPr
    tblw = put_child(tblpr, 'tblW', TBLPR_ORDER)
    tblw.set(qn('w:w'), str(int(sum(widths_cm) * 567)))
    tblw.set(qn('w:type'), 'dxa')
    bd = put_child(tblpr, 'tblBorders', TBLPR_ORDER)
    for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        el = OxmlElement('w:' + side)
        if borders:
            el.set(qn('w:val'), 'single')
            el.set(qn('w:sz'), '4')
            el.set(qn('w:space'), '0')
            el.set(qn('w:color'), 'auto')
        else:
            el.set(qn('w:val'), 'nil')
        bd.append(el)
    for i, w in enumerate(widths_cm):
        table.columns[i].width = Cm(w)
        for cell in table.columns[i].cells:
            cell.width = Cm(w)
    return table


def header_state(doc, left_cm, extra_cm=0.0):
    """Đầu văn bản chính quyền: cơ quan + số | quốc hiệu + địa danh, ngày tháng.

    extra_cm: bảng rộng hơn vùng chữ (căn giữa, lấn đều hai lề) để quốc hiệu nằm trên một dòng.
    """
    right_cm = content_width(doc) - left_cm + extra_cm
    t = make_table(doc, [left_cm, right_cm])
    left, right = t.cell(0, 0), t.cell(0, 1)
    add_para(left, '{cap_tren}', CENTER, first=True)
    add_para(left, '{don_vi}', CENTER, bold=True)
    short_rule(left, 2.2, left_cm)
    add_para(left, 'Số: {so_van_ban}', CENTER, size=13, before=6)
    add_para(right, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', CENTER, bold=True, size=13, first=True)
    add_para(right, 'Độc lập - Tự do - Hạnh phúc', CENTER, bold=True, underline=True)
    add_para(right)
    add_para(right, '{ngay_thang}', CENTER, italic=True)


def header_party(doc, left_cm, extra_cm=0.0):
    """Đầu văn bản Đảng: đảng ủy / chi bộ / * / số | ĐẢNG CỘNG SẢN VIỆT NAM / ngày tháng."""
    right_cm = content_width(doc) - left_cm + extra_cm
    t = make_table(doc, [left_cm, right_cm])
    left, right = t.cell(0, 0), t.cell(0, 1)
    add_para(left, '{dang_uy}', CENTER, first=True)
    add_para(left, '{chi_bo}', CENTER, bold=True)
    add_para(left, '*', CENTER)
    add_para(left, 'Số: {so_van_ban}', CENTER, size=13)
    add_para(right, 'ĐẢNG CỘNG SẢN VIỆT NAM', CENTER, bold=True, underline=True, first=True)
    add_para(right)
    add_para(right, '{ngay_thang}', CENTER, italic=True)


def title(doc, word, kinh_gui=False):
    add_para(doc, '', before=0, after=6)
    add_para(doc, word, CENTER, bold=True)
    add_para(doc, '{trich_yeu}', CENTER, bold=True, after=6 if kinh_gui else 12)
    if kinh_gui:
        add_para(doc, 'Kính gửi: {kinh_gui}', CENTER, after=12)


def body(doc):
    add_para(doc, '{noi_dung}', JUSTIFY, after=6, line=1.15, first_indent=Cm(1.27))


def signature(doc, left_cm, party=False):
    """Cuối văn bản: Nơi nhận | chức vụ (T/M CHI BỘ – BÍ THƯ), 3 dòng trống ký, họ tên."""
    right_cm = content_width(doc) - left_cm
    add_para(doc, '', after=6)
    t = make_table(doc, [left_cm, right_cm])
    left, right = t.cell(0, 0), t.cell(0, 1)
    add_para(left, 'Nơi nhận:', LEFT, bold=True, italic=True, size=12, first=True)
    add_para(left, '{noi_nhan}', LEFT, size=11)
    if party:
        add_para(right, 'T/M CHI BỘ', CENTER, bold=True, first=True)
        add_para(right, 'BÍ THƯ', CENTER, bold=True)
        name = '{bi_thu_ho_ten}'
    else:
        add_para(right, '{nguoi_ky_chuc_vu}', CENTER, bold=True, first=True)
        name = '{nguoi_ky_cap_bac} {nguoi_ky_ho_ten}'
    for _ in range(3):
        add_para(right)
    add_para(right, name, CENTER, bold=True)


def set_cell_text(cell, text, align=CENTER, bold=False, size=13):
    add_para(cell, text, align, bold=bold, size=size, first=True)
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def list_table(doc, columns):
    """columns: [(tiêu đề, độ rộng cm, ô dòng dữ liệu, căn lề)]; dòng dữ liệu lặp {#ds}…{/ds}."""
    widths = [c[1] for c in columns]
    t = make_table(doc, widths, rows=2, borders=True)
    head, data = t.rows[0], t.rows[1]
    trpr = head._tr.get_or_add_trPr()
    trpr.append(OxmlElement('w:cantSplit'))
    trpr.append(OxmlElement('w:tblHeader'))
    data._tr.get_or_add_trPr().append(OxmlElement('w:cantSplit'))
    n = len(columns)
    for i, (label, _w, value, align) in enumerate(columns):
        set_cell_text(head.cells[i], label, CENTER, bold=True)
        text = value
        if i == 0:
            text = '{#ds}' + text
        if i == n - 1:
            text = text + '{/ds}'
        set_cell_text(data.cells[i], text, align)
    return t


def build_plan(word, key):
    doc = new_document()
    header_state(doc, 6.0, 1.0)
    title(doc, word)
    body(doc)
    signature(doc, 7.0)
    return key, doc


def build_party_report():
    doc = new_document()
    header_party(doc, 6.5, 1.0)
    title(doc, 'BÁO CÁO', kinh_gui=True)
    body(doc)
    signature(doc, 7.0, party=True)
    return 'bao-cao-chi-bo', doc


def build_list(key, columns):
    doc = new_document(landscape=True)
    header_state(doc, 9.0)
    title(doc, 'DANH SÁCH')
    list_table(doc, columns)
    signature(doc, 14.0)
    return key, doc


QUAN_NHAN = [
    ('TT', 1.2, '{stt}', CENTER),
    ('Họ và tên', 4.8, '{ho_ten}', LEFT),
    ('Ngày sinh', 2.6, '{ngay_sinh}', CENTER),
    ('Cấp bậc', 2.6, '{cap_bac}', CENTER),
    ('Chức vụ', 3.0, '{chuc_vu}', CENTER),
    ('Đơn vị', 3.0, '{don_vi_qn}', CENTER),
    ('Dân tộc', 2.0, '{dan_toc}', CENTER),
    ('Quê quán', 4.4, '{que_quan}', LEFT),
    ('Ghi chú', 2.6, '', CENTER),
]
DANG_VIEN = [
    ('TT', 1.2, '{stt}', CENTER),
    ('Họ và tên', 5.0, '{ho_ten}', LEFT),
    ('Ngày sinh', 2.8, '{ngay_sinh}', CENTER),
    ('Dân tộc / Tôn giáo', 3.8, '{dan_toc} / {ton_giao}', CENTER),
    ('Quê quán', 5.0, '{que_quan}', LEFT),
    ('Ngày vào Đảng / Chính thức', 6.0, '{ngay_vao_dang} / {ngay_chinh_thuc}', CENTER),
    ('Ghi chú', 2.4, '', CENTER),
]

FIXED_DATE = (1980, 1, 1, 0, 0, 0)


def save_stable(doc, path):
    """Lưu với thời điểm cố định trong zip để dựng lại không đổi nội dung khi mẫu không đổi."""
    buf = io.BytesIO()
    doc.save(buf)
    src = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename == 'docProps/core.xml':
                data = re.sub(rb'<dcterms:(created|modified)[^>]*>[^<]*</dcterms:\1>', b'', data)
            zi = zipfile.ZipInfo(info.filename, FIXED_DATE)
            zi.compress_type = zipfile.ZIP_DEFLATED
            dst.writestr(zi, data)
    with open(path, 'wb') as f:
        f.write(out.getvalue())


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    docs = [
        build_plan('KẾ HOẠCH', 'ke-hoach'),
        build_plan('BÁO CÁO', 'bao-cao'),
        build_party_report(),
        build_list('danh-sach-quan-nhan', QUAN_NHAN),
        build_list('danh-sach-dang-vien', DANG_VIEN),
    ]
    for key, doc in docs:
        path = os.path.join(OUT_DIR, key + '.docx')
        save_stable(doc, path)
        print('Đã dựng', os.path.relpath(path))


if __name__ == '__main__':
    main()
