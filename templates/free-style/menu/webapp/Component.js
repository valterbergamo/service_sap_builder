sap.ui.define(
  [
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "./model/models",
    "./controller/_ErrorHandler",
  ],
  function (UIComponent, Device, models, ErrorHandler) {
    "use strict";

    return UIComponent.extend("xcop.fsc.service.Component", {
      metadata: {
        manifest: "json",
      },

      /**
       * The component is initialized by UI5 automatically during the startup of the app and calls the init method once.
       * In this function, the device models are set and the router is initialized.
       * @public
       * @override
       */
      init: async function () {
        // call the base component's init function
        UIComponent.prototype.init.apply(this, arguments);

        // initialize the error handler with the component
        this._oErrorHandler = new ErrorHandler(this);

        // set the device model
        this.setModel(models.createDeviceModel(), "device");

        //set Jason models
        this.setModel(models.createBlankJSONModel(), "token");
        this.setModel(models.createBlankJSONModel(), "config");
        this.setModel(models.createBlankJSONModel(), "menu");
        this.setModel(models.createBlankJSONModel(), "views");
        this.setModel(models.createBlankJSONModel(), "components");
        this.setModel(models.createBlankJSONModel(), "screenControl");
        this.setModel(models.createBlankJSONModel(), "searchHelp");
        this.setModel(models.createBlankJSONModel(), "attachments");
        this.setModel(models.createBlankJSONModel(), "device");

        // create the views based on the url/hash
        this.getRouter().initialize();
      },
      /**
       * @override
       */
      onBeforeRendering: async function () {
        //debugger
        //let oData = await this.onGetScreenControlFields()
        //this.getModel('screenControl').setData(oData)
      },

      /**
       * @override
       */
      onAfterRendering: async function () {
        UIComponent.prototype.onAfterRendering.apply(this, arguments);
       //debugger;

        let oRouter = this.getRouter();
        let sViews = this.getManifestEntry(
          "/sap.ui5/routing/viewsScreenControl"
        );
        let oProfiles = await this.getProfiles();
        let oConfig = await this.getConfig();

        this.getModel("screenControl").setData(oProfiles);
        this.getModel("config").setData(oConfig);

       //debugger;

        if (oConfig.ReadFields) {
          sViews.forEach(function (viewKey) {
            oRouter.navTo(viewKey.viewId);
          });
        }

        oRouter.navTo("home");
      },

      getConfig: function () {
        let that = this;

        let sNamespace = this.getManifestEntry("/sap.app/id");
        let sServiceUrl = this.getManifestEntry(
          "/sap.app/dataSources/mainService/uri"
        );
        let oModelOptions = "";

        let oModel = new sap.ui.model.odata.v2.ODataModel(
          sServiceUrl,
          oModelOptions
        );

        let sToken = oModel.getSecurityToken();

        let mHeaders = {
          token: sToken,
          namespace: sNamespace,
        };

        oModel.setHeaders(mHeaders);

        let vContext =
          "/configSet(Namespace='" + sNamespace + "',Token='" + sToken + "')";
        return new Promise(function (resolve, reject) {
          oModel.read(vContext, {
            success: function (oData, oResponse) {
              //debugger
              resolve(oData);
            },
            error: function (oError) {
              resolve(undefined);
            },
          });
        });
      },

      getProfiles: function () {
        //debugger

        let that = this;

        let sNamespace = this.getManifestEntry("/sap.app/id");
        let sServiceUrl = this.getManifestEntry(
          "/sap.app/dataSources/mainService/uri"
        );
        let oModelOptions = "";

        let oModel = new sap.ui.model.odata.v2.ODataModel(
          sServiceUrl,
          oModelOptions
        );

        let sToken = oModel.getSecurityToken();

        let mHeaders = {
          token: sToken,
          namespace: sNamespace,
        };

        oModel.setHeaders(mHeaders);

        let vContext =
          "/screenControlSet(Namespace='" +
          sNamespace +
          "',Token='" +
          sToken +
          "')";
        return new Promise(function (resolve, reject) {
          oModel.read(vContext, {
            urlParameters: {
              $expand: "fields,config",
            },
            success: function (oData, oResponse) {
              //debugger
              resolve(oData);
            },
            error: function (oError) {
              resolve(undefined);
            },
          });
        });
      },

      destroy: function () {
        this._oErrorHandler.destroy();
        // call the base component's destroy function
        UIComponent.prototype.destroy.apply(this, arguments);
      },

      /**
       * This method can be called to determine whether the sapUiSizeCompact or sapUiSizeCozy
       * design mode class should be set, which influences the size appearance of some controls.
       * @public
       * @return {string} css class, either 'sapUiSizeCompact' or 'sapUiSizeCozy' - or an empty string if no css class should be set
       */
      getContentDensityClass: function () {
        if (this._sContentDensityClass === undefined) {
          // check whether FLP has already set the content density class; do nothing in this case
          // eslint-disable-next-line fiori-custom/sap-no-proprietary-browser-api, fiori-custom/sap-browser-api-warning
          if (
            document.body.classList.contains("sapUiSizeCozy") ||
            document.body.classList.contains("sapUiSizeCompact")
          ) {
            this._sContentDensityClass = "";
          } else if (!Device.support.touch) {
            // apply "compact" mode if touch is not supported
            this._sContentDensityClass = "sapUiSizeCompact";
          } else {
            // "cozy" in case of touch support; default for most sap.m controls, but needed for desktop-first controls like sap.ui.table.Table
            this._sContentDensityClass = "sapUiSizeCozy";
          }
        }
        return this._sContentDensityClass;
      },
    });
  }
);
