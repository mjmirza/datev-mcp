# DATEV MCP live sweep, sandbox, as of 2026-11-07T19:26:13.547Z

126 read operations. 142 real HTTP calls recorded over 1 day(s): 2026-11-07.

Sweep complete for everything resolvable.

| Outcome | Operations |
|---|---|
| skipped | 55 |
| 2xx ok | 38 |
| 400 | 13 |
| 500 | 9 |
| 401/403 not permitted for this sandbox app | 6 |
| 404 no such resource | 3 |
| 501 | 1 |
| 301 | 1 |

| Operation | Status | ms | Shape | When | Note |
|---|---|---|---|---|---|
| accounting-clients.getclients | 200 | 304 | array(4) | 2026-11-07T19:22 |  |
| accounting-clients.getclient | 200 | 309 | object{client_number,consultant_number,id,name,services} | 2026-11-07T19:23 |  |
| accounting-dataexchange.getjobstate | skipped |  |  | 2026-11-07T18:01 | needs a real "jobId" that no list call has returned yet |
| accounting-dataexchange.getfiscalyears | 200 | 133 | array(1) | 2026-11-07T19:23 |  |
| accounting-dataexchange.getfiscalyear | 200 | 253 | array(1) | 2026-11-07T19:25 |  |
| accounting-dataexchange.getaccountingsequences | 200 | 63 | array(111) | 2026-11-07T19:25 |  |
| accounting-dataexchange.getgeneralledgeraccounts | 200 | 235 | string | 2026-11-07T19:25 |  |
| accounting-dataexchange.gettermsofpayments | 200 | 50 | array(7) | 2026-11-07T19:25 |  |
| accounting-dataexchange.getagriculturalfinancialstatement | 404 | 229 | object{detail,instance,status,title,type,request_id} | 2026-11-07T19:25 |  |
| accounting-dataexchange.getaccountpostingsjob | skipped |  |  | 2026-11-07T18:01 | needs a real "jobId" that no list call has returned yet |
| accounting-dataexchange.getopenitemsjob | skipped |  |  | 2026-11-07T18:01 | needs a real "jobId" that no list call has returned yet |
| accounting-dataexchange.getsumsandbalances | 200 | 88 | string | 2026-11-07T19:25 |  |
| accounting-dataexchange.getsumsandbalancesquantityandweightjob | skipped |  |  | 2026-11-07T18:01 | needs a real "jobId" that no list call has returned yet |
| accounting-documents.get_clients | 400 | 261 | string | 2026-11-07T19:22 |  |
| accounting-documents.get_clients_client_id | 400 | 119 | string | 2026-11-07T19:23 |  |
| accounting-documents.get_clients_client_id_document_types | 400 | 76 | string | 2026-11-07T19:23 |  |
| accounting-documents.get_clients_client_id_duo_version | 400 | 82 | string | 2026-11-07T19:24 |  |
| accounting-dxso-jobs.get_clients | 200 | 352 | array(6) | 2026-11-07T19:22 |  |
| accounting-dxso-jobs.get_clients_client_id | 200 | 479 | object{client_number,consultant_number,id,name,is_document_management_available,basic_accounting_information} | 2026-11-07T19:24 |  |
| accounting-dxso-jobs.get_clients_client_id_dxso_jobs_job_id | skipped |  |  | 2026-11-07T18:01 | needs a real "job-id" that no list call has returned yet |
| accounting-dxso-jobs.get_clients_client_id_dxso_jobs_job_id_protocol_entries | skipped |  |  | 2026-11-07T18:01 | needs a real "job-id" that no list call has returned yet |
| accounting-extf-files.getjobs | 200 | 145 | array(3) | 2026-11-07T19:24 |  |
| accounting-extf-files.getjob | 200 | 135 | object{client_application_display_name,client_application_vendor,data_category_id,date_from,date_to,filename} | 2026-11-07T19:25 |  |
| smarttransfer-inbound.get_documents_inbox | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_documents_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-inbound.get_documents_id_types | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-inbound.get_documents_id_info | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-inbound.get_documents_inbox_waitingdocuments_info | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_documents_inbox_waitingdocuments_ids | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_logs | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_logs_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-inbound.get_notifications | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_notifications_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-inbound.get_gov_poland_documents_received_documentid | skipped |  |  | 2026-11-07T18:01 | needs a real "documentId" that no list call has returned yet |
| smarttransfer-inbound.get_gov_serbia_documents_received | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_users | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_users_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-inbound.get_users_current | skipped |  |  | 2026-11-07T18:01 | needs a separate "X-API-Key" product key, not part of this OAuth app |
| smarttransfer-inbound.get_workflow_inbound_documentid_state | skipped |  |  | 2026-11-07T18:01 | needs a real "documentId" that no list call has returned yet |
| smarttransfer-inbound.get_workflow_inbound_documentid_state_transitions | skipped |  |  | 2026-11-07T18:01 | needs a real "documentId" that no list call has returned yet |
| smarttransfer-inbound.get_workflow_workflowname_tables | skipped |  |  | 2026-11-07T18:01 | needs a real "workflowName" that no list call has returned yet |
| smarttransfer-inbound.get_workflow_documentid_tables_tablename_contents | skipped |  |  | 2026-11-07T18:01 | needs a real "documentId" that no list call has returned yet |
| smarttransfer-outbound.get_documents_outbox | 500 | 96 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:22 |  |
| smarttransfer-outbound.get_documents_sentbox | 500 | 25 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:22 |  |
| smarttransfer-outbound.get_documents_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-outbound.get_documents_id_types | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-outbound.get_documents_id_info | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-outbound.get_logs | 500 | 107 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:22 |  |
| smarttransfer-outbound.get_logs_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-outbound.get_notifications | 500 | 33 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:22 |  |
| smarttransfer-outbound.get_notifications_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-outbound.get_gov_poland_documents_sent_documentid | skipped |  |  | 2026-11-07T18:01 | needs a real "documentId" that no list call has returned yet |
| smarttransfer-outbound.get_gov_serbia_documents_sent | 500 | 28 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:22 |  |
| smarttransfer-outbound.get_users | 500 | 30 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:22 |  |
| smarttransfer-outbound.get_users_id | skipped |  |  | 2026-11-07T18:01 | needs a real "id" that no list call has returned yet |
| smarttransfer-outbound.get_users_current | 500 | 35 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:22 |  |
| eau-api.getfeedbacks | skipped |  |  | 2026-11-07T18:01 | needs a real "personnelNumber" that no list call has returned yet |
| eau-api.getclients | 200 | 141 | string | 2026-11-07T19:25 |  |
| hr-documents-health.health | 401 | 420 | string | 2026-11-07T19:23 |  |
| hr-documents.getclients | 401 | 43 | string | 2026-11-07T19:23 |  |
| hr-documents.getclientbyconsultantclientnumber | 401 | 255 | string | 2026-11-07T19:24 |  |
| hr-exchange-health.health | 401 | 118 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:23 |  |
| hr-exchange.getclient | 200 | 144 | string | 2026-11-07T19:24 |  |
| hr-exchange.getjobclientresult | 200 | 147 | object{clients,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobemployeeresult | 200 | 69 | object{employees,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobemploymentperiodresult | 200 | 94 | object{employment_periods,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobmonthrecordresult | 200 | 82 | object{month_records,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobindividualdataresult | 501 | 146 | object{exchange_objects,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobabsenceresult | 200 | 147 | object{absences,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobabsenceresult_1 | 200 | 144 | object{absences_lodas,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobgrosspaymentresult | 200 | 150 | object{gross_payments,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjobhourlywageresult | 200 | 136 | object{hourly_wages,errors} | 2026-11-07T19:25 |  |
| hr-exchange.getjoberrorresult | 200 | 149 | object{exchange_objects,errors} | 2026-11-07T19:26 |  |
| hr-exchange.getjobresultstatus | 301 | 143 | string | 2026-11-07T19:26 |  |
| hr-exchange.getjob | 200 | 137 | object{id,state,time_stamp,time_stamp_updated} | 2026-11-07T19:26 |  |
| hr-exchange.getresthook | 200 | 145 | array(1) | 2026-11-07T19:24 |  |
| hr-exchange.getresthookbyid | 200 | 153 | string | 2026-11-07T19:26 |  |
| hr-exports.getclients | 400 | 443 | string | 2026-11-07T19:23 |  |
| hr-exports.getclientbyclientid | 400 | 333 | string | 2026-11-07T19:24 |  |
| hr-exports.gettaxpaymentsbyemployeeid | skipped |  |  | 2026-11-07T18:01 | needs a real "employee-id" that no list call has returned yet |
| hr-exports.getsocialsecuritypaymentsbyemployeeid | skipped |  |  | 2026-11-07T18:01 | needs a real "employee-id" that no list call has returned yet |
| hr-exports.getsalarytotalvaluesbyemployeeid | skipped |  |  | 2026-11-07T18:01 | needs a real "employee-id" that no list call has returned yet |
| hr-exports.getsalarypaymentsbyemployeeid | skipped |  |  | 2026-11-07T18:01 | needs a real "employee-id" that no list call has returned yet |
| hr-exports.getmasterdatabyemployeeid | skipped |  |  | 2026-11-07T18:01 | needs a real "employee-id" that no list call has returned yet |
| hr-exports.getaccountingrecordsbyemployeeid | skipped |  |  | 2026-11-07T18:01 | needs a real "employee-id" that no list call has returned yet |
| hr-exports.getabsencesbyemployeeid | skipped |  |  | 2026-11-07T18:01 | needs a real "employee-id" that no list call has returned yet |
| hr-exports.gettaxpaymentslistbyclientid | 400 | 64 | string | 2026-11-07T19:24 |  |
| hr-exports.getsocialsecuritypaymentslistbyclientid | 400 | 54 | string | 2026-11-07T19:24 |  |
| hr-exports.getsalarytotalvalueslistbyclientid | 400 | 138 | string | 2026-11-07T19:24 |  |
| hr-exports.getsalarypaymentslistbyclientid | 400 | 152 | string | 2026-11-07T19:24 |  |
| hr-exports.getmasterdatalistbyclientid | 400 | 131 | string | 2026-11-07T19:24 |  |
| hr-exports.getaccountingrecordslistbyclientid | 400 | 94 | string | 2026-11-07T19:24 |  |
| hr-exports.getabsenceslistbyclientid | 400 | 142 | string | 2026-11-07T19:24 |  |
| hr-exports.getpersonnelnumberbycompanypersonnelnumber | skipped |  |  | 2026-11-07T18:01 | needs a real "company-personnel-number" that no list call has returned yet |
| hr-files-health.health | 401 | 190 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:23 |  |
| hr-files.get_v1_clients_client_id_jobs_job_id | skipped |  |  | 2026-11-07T18:01 | needs a real "job-id" that no list call has returned yet |
| hr-files.get_v1_clients | 200 | 363 | array(6) | 2026-11-07T19:23 |  |
| hr-files.get_v1_clients_client_id | 200 | 251 | string | 2026-11-07T19:24 |  |
| hr-payrollreports.getclients | 200 | 148 | array(6) | 2026-11-07T19:23 |  |
| hr-payrollreports.getclientbyclientid | 200 | 240 | object{document_types,client_id,client_number,consultant_number} | 2026-11-07T19:24 |  |
| hr-payrollreports.getpdfdocuments | skipped |  |  | 2026-11-07T18:01 | needs a real "period" that no list call has returned yet |
| hr-payrollreports.getstatus | skipped |  |  | 2026-11-07T18:01 | needs a real "period" that no list call has returned yet |
| hr-payrollreports.getemployeenumbersbyperiod | skipped |  |  | 2026-11-07T18:01 | needs a real "period" that no list call has returned yet |
| hr-payrollreports.getdocumentmetadata | skipped |  |  | 2026-11-07T18:01 | needs a value for required query "document_types" |
| master-data-master-clients-health.info | 500 | 95 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:23 |  |
| master-data-master-clients-health.health | 500 | 25 | object{httpCode,httpMessage,moreInformation,status,title,detail} | 2026-11-07T19:23 |  |
| master-data-master-clients.findbyzmoid | 200 | 119 | object{id,data_environment_number,etag,container} | 2026-11-07T19:24 |  |
| master-data-master-clients.findconsultantclientbyclientzmoid | 404 | 68 | object{type,title,request_id,status,details} | 2026-11-07T19:24 |  |
| master-data-master-clients.getinfo | 200 | 568 | array(3) | 2026-11-07T19:23 |  |
| master-data-master-clients.findall | 200 | 146 | array(100) | 2026-11-07T19:23 |  |
| master-data-master-clients.findcorporatestructurebyzmoid | 404 | 96 | object{type,title,request_id,status,details} | 2026-11-07T19:24 |  |
| master-data-master-clients.getlegalforms | 200 | 174 | array(107) | 2026-11-07T19:23 |  |
| master-data-master-clients.findbynumber | skipped |  |  | 2026-11-07T18:01 | needs a real "number" that no list call has returned yet |
| master-data-master-clients.getcountrycodes | 200 | 107 | array(253) | 2026-11-07T19:23 |  |
| my-tax-income-tax-documents.getclients | 200 | 324 | array(11) | 2026-11-07T19:23 |  |
| my-tax-income-tax-documents.getclient | 200 | 376 | object{client_email,client_id,client_lueid,client_name,client_zmoid} | 2026-11-07T19:25 |  |
| my-tax-income-tax-documents.getincometaxyears | 200 | 57 | object{addable_tax_years,tax_years} | 2026-11-07T19:25 |  |
| my-tax-income-tax-documents.getincometaxfolders | skipped |  |  | 2026-11-07T18:01 | needs a real "tax-year" that no list call has returned yet |
| my-tax-mytax-income-tax-documents-health.health | 401 | 35 | string | 2026-11-07T19:23 |  |
| traffiqx-invoice.downloadreceiveddocumentbyid | skipped |  |  | 2026-11-07T18:01 | needs a real "traffiqx_id" that no list call has returned yet |
| traffiqx-invoice.getinboxdocumentids | skipped |  |  | 2026-11-07T18:01 | needs a real "traffiqx_id" that no list call has returned yet |
| traffiqx-invoice.getinboxdocumentmetadatabyid | skipped |  |  | 2026-11-07T18:01 | needs a real "traffiqx_id" that no list call has returned yet |
| traffiqx-invoice.getdocumentstatusbyid | skipped |  |  | 2026-11-07T18:01 | needs a real "traffiqx_id" that no list call has returned yet |
| traffiqx-invoice.downloadsentdocumentbyid | skipped |  |  | 2026-11-07T18:01 | needs a real "traffiqx_id" that no list call has returned yet |
| traffiqx-invoice.getoutboxdocumentids | skipped |  |  | 2026-11-07T18:01 | needs a real "traffiqx_id" that no list call has returned yet |
| traffiqx-invoice.getoutboxdocumentmetadatabyid | skipped |  |  | 2026-11-07T18:01 | needs a real "traffiqx_id" that no list call has returned yet |