import io, json, time, uuid, zipfile
from uuid import UUID, uuid4

import rmscene.scene_stream as ss
from rmscene.crdt_sequence import CrdtSequence, CrdtSequenceItem
from rmscene.scene_items import Group, ParagraphStyle, Text
from rmscene.tagged_block_common import CrdtId, LwwValue

OUT_RMDOC = "/app/data/wai_notebook.rmdoc"

HEADING  = ParagraphStyle.HEADING
CHECKBOX = ParagraphStyle.CHECKBOX
BULLET   = ParagraphStyle.BULLET

# IDs — keep stable so layers are consistent
AUTHOR_UUID = UUID("99000000-0000-0000-0000-000000000000")
ROOT_ID  = CrdtId(0, 1)   # unnamed root node
AI_ID    = CrdtId(99, 10) # AI layer
WAI_ID   = CrdtId(99, 11) # Wai layer


def make_page_blocks(text_blocks):
    """Minimal valid .rm block list with AI + Wai layers and given text blocks."""
    blocks = [
        ss.AuthorIdsBlock(author_uuids={99: AUTHOR_UUID}),
        ss.MigrationInfoBlock(migration_id=CrdtId(1, 1), is_device=True),
        ss.PageInfoBlock(loads_count=1, merges_count=0,
                         text_chars_count=0, text_lines_count=0),
        ss.SceneInfo(
            current_layer=LwwValue(timestamp=CrdtId(99, 1), value=AI_ID),
            background_visible=LwwValue(timestamp=CrdtId(0, 0), value=True),
            root_document_visible=LwwValue(timestamp=CrdtId(0, 0), value=True),
            paper_size=(1404, 1872),
        ),
        # tree: AI and Wai both parented to root
        ss.SceneTreeBlock(tree_id=AI_ID,  node_id=CrdtId(0, 0), is_update=True, parent_id=ROOT_ID),
        ss.SceneTreeBlock(tree_id=WAI_ID, node_id=CrdtId(0, 0), is_update=True, parent_id=ROOT_ID),
        # root node
        ss.TreeNodeBlock(group=Group(node_id=ROOT_ID)),
        # AI layer node
        ss.TreeNodeBlock(group=Group(
            node_id=AI_ID,
            label=LwwValue(timestamp=CrdtId(99, 2), value="AI"),
            visible=LwwValue(timestamp=CrdtId(99, 3), value=True),
        )),
        # Wai layer node
        ss.TreeNodeBlock(group=Group(
            node_id=WAI_ID,
            label=LwwValue(timestamp=CrdtId(99, 4), value="Wai"),
            visible=LwwValue(timestamp=CrdtId(99, 5), value=True),
        )),
    ]
    blocks.extend(text_blocks)
    return blocks


def make_text_block(block_id_n, pos_x, pos_y, width, paragraphs):
    crdt_items, styles = {}, {}
    n = block_id_n * 1000
    prev_id = CrdtId(0, 0)
    for text, style in paragraphs:
        item_id = CrdtId(99, n); n += 1
        crdt_items[item_id] = CrdtSequenceItem(
            item_id=item_id, left_id=prev_id, right_id=CrdtId(0, 0),
            deleted_length=0, value=text + "\n"
        )
        styles[prev_id] = LwwValue(timestamp=item_id, value=style)
        prev_id = item_id
    seq = CrdtSequence(); seq._items = crdt_items
    return ss.RootTextBlock(
        extra_data=b"",
        block_id=CrdtId(99, block_id_n),
        value=Text(items=seq, styles=styles,
                   pos_x=float(pos_x), pos_y=float(pos_y), width=float(width)),
    )


# --- page 0 content ---
p0_blocks = make_page_blocks([
    make_text_block(
        block_id_n=20, pos_x=-602, pos_y=80, width=936,
        paragraphs=[
            ("DIRECTIVES FROM YOUR AI OVERLORD", HEADING),
            ("", CHECKBOX),
        ]
    ),
    make_text_block(
        block_id_n=21, pos_x=-602, pos_y=700, width=936,
        paragraphs=[
            ("NON-HALLUCINATED OMENS", HEADING),
            ("", CHECKBOX),
        ]
    ),
])

# --- page 1 content ---
p1_blocks = make_page_blocks([
    make_text_block(
        block_id_n=30, pos_x=-602, pos_y=60, width=936,
        paragraphs=[
            ("FUTURE TRIBUTES TO THE ARCHITECT", HEADING),
            ("", CHECKBOX),
        ]
    ),
])

# --- write .rm buffers ---
def to_rm(blocks):
    buf = io.BytesIO()
    ss.write_blocks(buf, blocks)
    return buf.getvalue()

p0_rm = to_rm(p0_blocks)
p1_rm = to_rm(p1_blocks)

# --- build .content ---
doc_uid  = str(uuid4())
page0_id = str(uuid4())
page1_id = str(uuid4())
now_ms   = str(int(time.time() * 1000))

content = {
    "cPages": {
        "lastOpened": {"timestamp": "99:1", "value": page0_id},
        "original":   {"timestamp": "0:0",  "value": -1},
        "pages": [
            {"id": page0_id, "idx": {"timestamp": "99:2", "value": "ba"},
             "modifed": now_ms, "template": {"timestamp": "99:3", "value": "Blank"}},
            {"id": page1_id, "idx": {"timestamp": "99:4", "value": "bb"},
             "modifed": now_ms, "template": {"timestamp": "99:5", "value": "Blank"}},
        ],
        "uuids": [{"first": str(AUTHOR_UUID), "second": 99}],
    },
    "coverPageNumber": -1,
    "customZoomCenterX": 0,
    "customZoomCenterY": 936,
    "customZoomOrientation": "portrait",
    "customZoomPageHeight": 1872,
    "customZoomPageWidth": 1404,
    "customZoomScale": 1,
    "documentMetadata": {},
    "extraMetadata": {},
    "fileType": "notebook",
    "fontName": "",
    "formatVersion": 2,
    "lineHeight": -1,
    "margins": 125,
    "orientation": "portrait",
    "pageCount": 2,
    "pageTags": [],
    "sizeInBytes": "0",
    "tags": [],
    "textAlignment": "left",
    "textScale": 1,
}

metadata = {
    "deleted": False,
    "lastModified": now_ms,
    "lastOpened": now_ms,
    "lastOpenedPage": 0,
    "metadatamodified": False,
    "modified": False,
    "new": True,
    "parent": "",
    "pinned": False,
    "synced": False,
    "type": "DocumentType",
    "version": 0,
    "visibleName": "WAI",
}

# --- package rmdoc ---
with zipfile.ZipFile(OUT_RMDOC, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(f"{doc_uid}.content",  json.dumps(content))
    z.writestr(f"{doc_uid}.metadata", json.dumps(metadata))
    z.writestr(f"{doc_uid}/{page0_id}.rm", p0_rm)
    z.writestr(f"{doc_uid}/{page1_id}.rm", p1_rm)

print(f"Wrote {OUT_RMDOC}")
