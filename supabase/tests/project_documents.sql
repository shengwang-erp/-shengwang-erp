begin;
select plan(3);
select has_table('public','project_document_logicals');
select has_table('public','project_documents');
select has_table('public','project_document_events');
select * from finish();
rollback;
