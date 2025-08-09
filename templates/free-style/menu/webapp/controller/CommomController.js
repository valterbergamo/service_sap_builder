sap.ui.define(
    [
      'sap/ui/core/mvc/Controller',
      'sap/m/library',
      '../model/models',
      'sap/f/library'
    ],
    function (
      Controller,
      mobileLibrary,
      models,
      fioriLibrary
    ) {
      'use strict'
  
      var MessageBox = mobileLibrary.MessageBox;
  
      return Controller.extend("xcop.fsc.service.controller.CommomController", {
          /**
           * Incluir funções comuns do aplicativo, não alterar o Base Controller pois é comum a todos aplicativos.
           */
           teste:function(){
                sap.m.MessageToast.show("Controlador comum")
           } 
  
      })
    }
  )
  