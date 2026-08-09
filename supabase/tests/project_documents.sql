begin;
select plan(3);
select has_table('public','project_document_logicals','project document logical table exists');
select has_table('public','project_documents','project document version table exists');
select has_table('public','project_document_events','project document event table exists');
select * from finish();
rollback;
