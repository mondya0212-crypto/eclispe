/**
 * ECLIPSE Guild Manager - Google Forms -> Next.js -> Supabase
 *
 * Form question titles expected:
 *   닉네임 / 직업 / 투력 / 메모
 *
 * 1) Paste this into Google Sheets -> Extensions -> Apps Script.
 * 2) Set API_URL and TOKEN below.
 * 3) Run installTrigger() once and authorize.
 * 4) Use syncAllRows() once if the sheet already contains members.
 */
const API_URL = 'https://YOUR-ECLIPSE-DOMAIN.vercel.app/api/integrations/members';
const TOKEN = 'CHANGE_ME_TO_THE_SAME_ECLIPSE_INTEGRATION_TOKEN';

function value_(namedValues, key) {
  const values = namedValues[key];
  return values && values.length ? String(values[0]).trim() : '';
}

function sendMember_(row) {
  const response = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-eclipse-integration-token': TOKEN },
    payload: JSON.stringify(row),
    muteHttpExceptions: true,
  });
  Logger.log(response.getResponseCode() + ' ' + response.getContentText());
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
}

function onFormSubmit(e) {
  const nv = e.namedValues || {};
  sendMember_({
    name: value_(nv, '닉네임'),
    job: value_(nv, '직업'),
    power: Number(value_(nv, '투력').replace(/,/g, '')) || 0,
    memo: value_(nv, '메모'),
  });
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(SpreadsheetApp.getActive()).onFormSubmit().create();
}

function syncAllRows() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const idx = key => headers.indexOf(key);
  values.slice(1).forEach(row => {
    const name = idx('닉네임') >= 0 ? String(row[idx('닉네임')]).trim() : '';
    if (!name) return;
    sendMember_({
      name,
      job: idx('직업') >= 0 ? String(row[idx('직업')]).trim() : '',
      power: idx('투력') >= 0 ? Number(String(row[idx('투력')]).replace(/,/g, '')) || 0 : 0,
      memo: idx('메모') >= 0 ? String(row[idx('메모')]).trim() : '',
    });
  });
}

// Google Apps Script editor compatibility helper.
// If the editor is still showing "myFunction", selecting this function
// will run the trigger installer and create the onFormSubmit trigger.
function myFunction() {
  installTrigger();
}
