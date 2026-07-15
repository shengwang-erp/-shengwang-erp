const SENSITIVE=['project_contract','contract_change_document']
const eligible=e=>e?.status==='active'&&e?.employment_status==='employed'&&e?.has_changed_password===true
export function canViewProjectDocumentKind(employee,kind){if(!eligible(employee))return false; return kind==='rendering'||(SENSITIVE.includes(kind)&&employee.employee_no==='SW-000')}
export function canUpdateProjectDocumentKind(employee,kind){return canViewProjectDocumentKind(employee,kind)}
export function canViewDeletedProjectArchive(employee){return eligible(employee)&&employee.employee_no==='SW-000'}
