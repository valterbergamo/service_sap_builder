sap.ui.define(['./_BaseController'], function (BaseController) {
	'use strict';

	return BaseController.extend('xcop.fsc.service.controller.App', {
		onInit: async function () {
			// apply content density mode to root view
			let oView = this.getView();

			this.getView().addStyleClass(this.getOwnerComponent().getContentDensityClass());
		},

		onBeforeRendering: async function () {},

		onAfterRendering: function () {}
	});
});
