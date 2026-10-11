'use strict';
// Independent review ledger: 200 snapshot - 100 paid cost = 100 observed cash.
module.exports = () => ({
  "asOf": "2026-10-11",
  "plan": {
    "windowDays": 40,
    "opening": {
      "asOf": "2026-10-11",
      "paydaySnapshot": {
        "periodStart": "2026-10-09",
        "asOf": "2026-10-09",
        "opening": 200
      },
      "representedEvents": [
        {
          "id": "annual",
          "date": "2026-10-10"
        }
      ]
    },
    "defaults": {
      "targetBuffer": 20,
      "extraDebtMonthly": 0
    },
    "startingCash": {
      "breakdown": [
        {
          "id": "chequing-a",
          "value": 100
        },
        {
          "id": "chequing-b",
          "value": 0
        },
        {
          "id": "savings",
          "value": 0
        }
      ]
    },
    "income": [
      {
        "id": "payroll",
        "label": "Payroll",
        "frequency": "biweekly",
        "anchor": "2026-08-14",
        "amount": 0,
        "confidence": "confirmed"
      },
      {
        "id": "gift",
        "label": "Later receipt",
        "frequency": "once",
        "date": "2026-11-02",
        "amount": 77,
        "confidence": "estimated"
      }
    ],
    "bills": [
      {
        "id": "annual",
        "label": "Annual cost",
        "frequency": "yearly",
        "month": 10,
        "day": 10,
        "firstDue": "2026-10-10",
        "amount": 100,
        "jointCash": false,
        "confidence": "confirmed",
        "payingAccount": "travelvisa"
      }
    ],
    "obligations": [],
    "commitments": [],
    "budget": {
      "categories": []
    }
  },
  "opts": {
    "weeklyVariable": 0,
    "debts": [
      {
        "id": "travelvisa",
        "label": "Invented card",
        "structure": "Revolving credit",
        "balance": 0,
        "pending": 0,
        "limit": 1000,
        "rate": 20,
        "confidence": "verified"
      }
    ],
    "currentPeriodActuals": {
      "schema": "atlas-current-period-actuals/v1",
      "currency": "CAD",
      "observationAsOf": "2026-10-11",
      "coverageStart": "2026-10-09",
      "coverageThrough": "2026-10-11",
      "pendingCoverage": "complete",
      "transactionCoverage": {
        "complete": true
      },
      "representedActuals": [
        {
          "id": "annual",
          "date": "2026-10-10",
          "actual": 100,
          "transactionId": "annual-posted"
        }
      ],
      "transactions": [
        {
          "id": "annual-posted",
          "date": "2026-10-10",
          "amount": 100,
          "pending": false,
          "currency": "CAD",
          "atlasAccountId": "travelvisa",
          "accountRole": "revolving-credit",
          "billId": "annual"
        },
        {
          "id": "annual-backfill-out",
          "date": "2026-10-10",
          "amount": 100,
          "pending": false,
          "currency": "CAD",
          "atlasAccountId": "chequing-a",
          "accountRole": "household-cash",
          "kindHint": "card-payment"
        },
        {
          "id": "annual-backfill-in",
          "date": "2026-10-10",
          "amount": -100,
          "pending": false,
          "currency": "CAD",
          "atlasAccountId": "travelvisa",
          "accountRole": "revolving-credit",
          "kindHint": "card-payment"
        }
      ]
    }
  }
});
