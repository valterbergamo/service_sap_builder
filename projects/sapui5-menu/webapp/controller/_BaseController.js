sap.ui.define(
  [
    "./CommomController",
    "sap/ui/core/UIComponent",
    "sap/m/library",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
   
  ],
  function (
    CommomController,
    UIComponent,
    mobileLibrary,
    Fragment,
    MessageBox
  ) {
    "use strict";

    var gValue = "";
    var gInputId = "";
    var gInput = "";
    var gObjInput;

    // shortcut for sap.m.URLHelper
    var URLHelper = mobileLibrary.URLHelper;

    return CommomController.extend(
      "xcop.fsc.service.controller._BaseController",
      {
        /**
         * Convenience method for accessing the router.
         * @public
         * @returns {sap.ui.core.routing.Router} the router for this component
         */
        getRouter: function () {
          //debugger
          return UIComponent.getRouterFor(this);
        },

        /**
         * Convenience method for getting the view model by name.
         * @public
         * @param {string} [sName] the model name
         * @returns {sap.ui.model.Model} the model instance
         */
        getModel: function (sName) {
          return this.getView().getModel(sName);
        },

        /**
         * Convenience method for setting the view model.
         * @public
         * @param {sap.ui.model.Model} oModel the model instance
         * @param {string} sName the model name
         * @returns {sap.ui.mvc.View} the view instance
         */
        setModel: function (oModel, sName) {
          return this.getView().setModel(oModel, sName);
        },

        /**
         * Getter for the resource bundle.
         * @public
         * @returns {sap.ui.model.resource.ResourceModel} the resourceModel of the component
         */
        getResourceBundle: function () {
          return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },

        /**
         * Event handler when the share by E-Mail button has been clicked
         * @public
         */
        

        //26.05.2025 - Incluso nvas funcionalidades - Valter Bergamo
      }
    );
  }
);
