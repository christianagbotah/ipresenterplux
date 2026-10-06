export const EDGE_OPERATOR_ACTIVE_SERVICE_SQL = `select s.id::text,s.title,s.status,s.active_bible_version,
       s.scheduled_start::text,s.started_at::text,s.updated_at::text
from edge_devices d
join services s
  on s.id=d.active_service_id
 and s.organization_id=d.organization_id
 and s.campus_id is not distinct from d.campus_id
 and s.status in ('ready','live')
where d.id=$1 and d.organization_id=$2 and d.status='active'
limit 1`;

export const EDGE_OPERATOR_BIBLE_VERSIONS_SQL = `select id,name,abbreviation,language_code
from bible_versions
where local_enabled=true
order by name,id
limit 32`;

export const EDGE_OPERATOR_PRESENTATION_ITEMS_SQL = `select id::text,item_type,title,content,sort_order,state,updated_at::text
from presentation_items
where service_id=$1
order by sort_order,id
limit 200`;

export const EDGE_OPERATOR_SCRIPTURE_QUEUE_SQL = `select sd.id::text,sd.scripture_reference,sd.bible_version,sd.book,sd.chapter,
       sd.verse_start,sd.verse_end,sd.source_text,sd.state,sd.detected_at::text,
       coalesce((
         select string_agg(bv.text, ' ' order by bv.verse)
         from bible_books bb
         join bible_verses bv
           on bv.version_id=bb.version_id and bv.book_code=bb.book_code
         where bb.version_id=sd.bible_version
           and lower(bb.canonical_name)=lower(sd.book)
           and bv.chapter=sd.chapter
           and sd.verse_start is not null
           and bv.verse between sd.verse_start and coalesce(sd.verse_end,sd.verse_start)
       ),sd.source_text) as passage_text
from scripture_detections sd
where sd.service_id=$1 and sd.state <> 'dismissed'
order by sd.detected_at desc,sd.id
limit 200`;

export const EDGE_OPERATOR_SCRIPTURE_SERVICE_SQL = `select s.id::text,s.active_bible_version
from edge_devices d
join services s
  on s.id=d.active_service_id
 and s.organization_id=d.organization_id
 and s.campus_id is not distinct from d.campus_id
 and s.status in ('ready','live')
where d.id=$1 and d.organization_id=$2 and d.status='active'
limit 1`;

export const EDGE_OPERATOR_SCRIPTURE_VERSION_SQL = `select id,abbreviation
from bible_versions
where upper(id)=upper($1) and local_enabled=true
limit 1`;

export const EDGE_OPERATOR_SCRIPTURE_BOOK_SQL = `select book_code,canonical_name
from bible_books
where version_id=$1
  and (lower(canonical_name)=lower($2) or lower(book_code)=lower($2))
limit 1`;

export const EDGE_OPERATOR_SCRIPTURE_CHAPTER_SQL = `select verse,text
from bible_verses
where version_id=$1 and book_code=$2 and chapter=$3
order by verse
limit 81`;

export const EDGE_OPERATOR_SCRIPTURE_RANGE_SQL = `select verse,text
from bible_verses
where version_id=$1 and book_code=$2 and chapter=$3
  and verse between $4 and $5
order by verse
limit 81`;
