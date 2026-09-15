/* Authoritative FNB Gold Business Account register.
 * Imported from the twelve attached GOLD_BUSINESS_ACCOUNT DOCX statements.
 * Statement turnover is kept separate from the operational ledger until a
 * transaction is explicitly allocated, preventing double-counting.
 */
window.UW_FNB_STATEMENTS = {
  version: "fnb-gold-business-2025-2026-docx-2026-09-15",
  sourceFolder: "Attached statements / GOLD_BUSINESS_ACCOUNT_1-12.docx",
  extractionMethod: "DOCX text extraction with statement-level reconciliation",
  extractionStatus: "Imported and reconciled from 12 authoritative FNB statements. Transactions remain unallocated pending category review.",
  account: {bank:"First National Bank", product:"Gold Business Account", accountNumber:"63173509557", branchCode:"250655", currency:"ZAR"},
  categories: ["Personal","Fuel","Consumables/Materials","Utilities","Rent","Staff","Marketing","Bank Fees","Loan","Client Receipt/Income","Transfer","Other"],
  reconciliation: {
    statementCount: 12,
    pageCount: 44,
    extractedRows: 1563,
    verifiedRows: 1563,
    matchedRows: 0,
    unmatchedRows: 1563,
    needsReviewRows: 1563,
    verifiedDebits: 1037709.38,
    verifiedCredits: 1043240.67,
    verifiedNet: 5531.29
  },
  statements: [
    {id:"fnb-01",name:"GOLD_BUSINESS_ACCOUNT_1.docx",path:"Attached statement",pages:2,statementDate:"2025-09-30",period:"4 September 2025 to 30 September 2025",openingBalance:0,closingBalance:5931.50,creditTransactions:7,debitTransactions:14,credits:53560.35,debits:47628.85,serviceFees:302.46,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-02",name:"GOLD_BUSINESS_ACCOUNT_2.docx",path:"Attached statement",pages:2,statementDate:"2025-10-31",period:"30 September 2025 to 31 October 2025",openingBalance:5931.50,closingBalance:5779.87,creditTransactions:13,debitTransactions:55,credits:53118.18,debits:53269.81,serviceFees:649.00,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-03",name:"GOLD_BUSINESS_ACCOUNT_3.docx",path:"Attached statement",pages:3,statementDate:"2025-11-30",period:"31 October 2025 to 30 November 2025",openingBalance:5779.87,closingBalance:11288.86,creditTransactions:24,debitTransactions:83,credits:91882.20,debits:86373.21,serviceFees:814.58,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-04",name:"GOLD_BUSINESS_ACCOUNT_4.docx",path:"Attached statement",pages:3,statementDate:"2025-12-31",period:"30 November 2025 to 31 December 2025",openingBalance:11288.86,closingBalance:8208.10,creditTransactions:21,debitTransactions:77,credits:63424.00,debits:66504.76,serviceFees:675.47,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-05",name:"GOLD_BUSINESS_ACCOUNT_5.docx",path:"Attached statement",pages:2,statementDate:"2026-01-31",period:"31 December 2025 to 31 January 2026",openingBalance:8208.10,closingBalance:6632.75,creditTransactions:13,debitTransactions:49,credits:51967.50,debits:53542.85,serviceFees:612.83,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-06",name:"GOLD_BUSINESS_ACCOUNT_6.docx",path:"Attached statement",pages:4,statementDate:"2026-02-28",period:"31 January 2026 to 28 February 2026",openingBalance:6632.75,closingBalance:2271.99,creditTransactions:31,debitTransactions:113,credits:61678.33,debits:66039.09,serviceFees:954.85,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-07",name:"GOLD_BUSINESS_ACCOUNT_7.docx",path:"Attached statement",pages:3,statementDate:"2026-03-31",period:"28 February 2026 to 31 March 2026",openingBalance:2271.99,closingBalance:2567.84,creditTransactions:27,debitTransactions:48,credits:77805.24,debits:77509.39,serviceFees:941.70,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-08",name:"GOLD_BUSINESS_ACCOUNT_8.docx",path:"Attached statement",pages:3,statementDate:"2026-04-30",period:"31 March 2026 to 30 April 2026",openingBalance:2567.84,closingBalance:15709.17,creditTransactions:25,debitTransactions:57,credits:94747.30,debits:81605.97,serviceFees:749.40,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-09",name:"GOLD_BUSINESS_ACCOUNT_9.docx",path:"Attached statement",pages:4,statementDate:"2026-05-31",period:"30 April 2026 to 31 May 2026",openingBalance:15709.17,closingBalance:7894.89,creditTransactions:28,debitTransactions:144,credits:113997.01,debits:121811.29,serviceFees:873.04,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-10",name:"GOLD_BUSINESS_ACCOUNT_10.docx",path:"Attached statement",pages:4,statementDate:"2026-06-30",period:"31 May 2026 to 30 June 2026",openingBalance:7894.89,closingBalance:16574.37,creditTransactions:37,debitTransactions:142,credits:117520.15,debits:108840.67,serviceFees:718.38,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-11",name:"GOLD_BUSINESS_ACCOUNT_11.docx",path:"Attached statement",pages:7,statementDate:"2026-07-31",period:"30 June 2026 to 31 July 2026",openingBalance:16574.37,closingBalance:11469.84,creditTransactions:51,debitTransactions:235,credits:138904.77,debits:144009.30,serviceFees:1515.49,status:"Imported",includedInTotals:true,transactions:[]},
    {id:"fnb-12",name:"GOLD_BUSINESS_ACCOUNT_12.docx",path:"Attached statement",pages:6,statementDate:"2026-08-31",period:"31 July 2026 to 31 August 2026",openingBalance:11469.84,closingBalance:5531.29,creditTransactions:29,debitTransactions:240,credits:124635.64,debits:130574.19,serviceFees:1388.14,status:"Imported",includedInTotals:true,transactions:[]}
  ]
};
