sap.ui.define(
  [
    './_BaseController',
    'sap/ui/model/json/JSONModel',
    '../model/formatter',
    'sap/ui/model/Filter',
    'sap/ui/model/FilterOperator'
  ],
  function (BaseController, JSONModel, formatter, Filter, FilterOperator) {
    'use strict'

    return BaseController.extend('xcop.fsc.service.controller.Home', {
      onInit: function () {
        //debugger

        let oOwnerComponent = this.getOwnerComponent();
        let oRouter = oOwnerComponent.getRouter();
        oRouter = oOwnerComponent.getRouter()

        this.getRouter().getRoute('home').attachPatternMatched(this._onObjectMatched, this)
        
      },
      onBeforeRendering: function () {
        //debugger
      },
      /**
       * @override
       */
      onAfterRendering: function () {

      },
      _onObjectMatched: function (oEvent) {

      }
    })
  }
)
