#-----------------------------------------------------------------------------------------------------------------------------------------
#-----------------------------------------------------------------------------------------------------------------------------------------
#
#Hola Soy Axel, el creador de este codigo, para correr este programa debes instalar tkinter con pip en tu CMD
#---------------------------------------------------------------------------------------------------------------
# (1er paso)
# Abre tu cmd como administrador (en el buscador de windows busca cmd)
# 2do paso instalar pip si no lo tienes es facil
#https://phoenixnap.com/kb/install-pip-windows
# luego de instalar pip usa pip install tkinter en el cmd

#-----------------------------------------------------------------------------------------------------------------------------------------
#-----------------------------------------------------------------------------------------------------------------------------------------






from tkinter import *
import sqlite3

con = sqlite3.connect("mydb.db") 
cursor = con.cursor()
query0 = """
CREATE TABLE  contactos(contactoid integer primary key autoincrement, nombrecontacto text, numerocontacto integer, correocontacto text); """

query2 = """ SELECT * FROM contactos; """



ventana = Tk()
ventana.title("                                                                                                                                                                                                            Agenda VyperCode")
ventana.geometry("1500x500")
ventana.configure(bg= "black")
Marco_menu = Frame(ventana, width = 400, height = 700, bg = "grey")

#Imagen
Marco_photo = Frame(ventana, width = 400, height = 400, bg = "green4")
img = PhotoImage(file="vyper.png")
lbl_img = Label(Marco_photo,width = 100, height = 100, image = img)
lbl_img.pack()

#Entrada de texto
e_texto = Entry(Marco_menu, font = ("Console 20"))

# variable global
i = 0


# funciones tkinter
def click_boton(valor):
    global i
    e_texto.insert(i, valor)
    # cada vez que se introduzca un valor se le suma uno para que a la hora de escribir 123 se escriba y no 321
    i += 1

#funcion para borrar
def borrar():
    e_texto.delete(0, END)


# funciones
def insertar (nombrecontacto,numerocontacto,correocontacto):
   

   query1 = """ INSERT INTO contactos(nombrecontacto, numerocontacto, correocontacto) VALUES (?,?,?); """
   info_tupla = (nombrecontacto,numerocontacto,correocontacto)
   cursor.execute(query1, info_tupla)
   con.commit()
   print("Datos Guardados")

def busquedanombre(nombrecontacto):
    query3 = """ SELECT *  FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query3, (nombrecontacto,))
    res = cursor.fetchall()
    print(res)

def busquedanumero(numerocontacto):
    query4 = """ SELECT * FROM contactos WHERE numerocontacto = ? """
    cursor.execute(query4, (numerocontacto,))
    res = cursor.fetchall()
    print(res)

def borrar_Cont(nombrecontacto):
    query4 ="""DELETE FROM contactos WHERE nombrecontacto = ? """
    cursor.execute(query4, (nombrecontacto,))

def actualizarcontacto(nombrecontacto,numerocontacto,correocontacto,contactoid):
   query6 = """ UPDATE  contactos SET nombrecontacto = ?, numerocontacto = ?, correocontacto = ? where contactoid = ?; """
   cursor.execute(query6,[nombrecontacto,numerocontacto,correocontacto,contactoid])
   con.commit()


    
        
    

# def para ventana añadir contactos
# Usando label1= Button(Marco_menu, text= "Añadir Contactos",command= lambda: )
def wninsertar():
    global wninsertar
    ventana.withdraw()
    wninsertar = Toplevel(ventana) #para crear una ventana a partir de la principal en este caso ventana 1 que es (ventana)
    wninsertar.geometry ("1500x400")
    wninsertar.title("Agregar Contactos")
    #wninsertar.configure(bg= "black")
    marco = Frame(wninsertar, width = 400, height = 700, bg = "grey")

    def volver():
        ventana.iconify()
        ventana.deiconify()
        wninsertar.destroy()


    

    botona = Button(marco, text = "Atrás", width = 15, height = 2 ,bg = "orange", command = lambda: volver())
    botona.grid(row = 1, column = 1, padx = 5 , pady = 5)
    
    label0 = Label(marco, text= "Hola, estoy en desarrollo", )
    label0.grid(row = 1, column = 3, padx = 5 , pady = 5)


    marco.grid(row = 4, column = 9, padx = 20, pady = 50) 





# def salir():



# Botones
boton1 = Button(Marco_menu, text = "Ir",bg = "green", fg= "white",width = 15, height = 2 , command = lambda: click_boton("Ir"))
boton2 = Button(Marco_menu, text = "Salir",bg = "green",fg= "white", width = 15, height = 2 , command = lambda: borrar_Cont())
botonB = Button(Marco_menu, text = "Borrar", fg= "white",bg = "red",  width= 5 , height= 2 , command= lambda: borrar())
#opciones y botones a ventanas
label1= Button(Marco_menu, text= "Añadir Contactos",command= lambda:wninsertar(),bg = "orange" )
label2= Button(Marco_menu, text= "Busqueda nombre",bg = "orange",)
label3= Button(Marco_menu, text= "Buscar por ID",bg = "orange")
label4= Button(Marco_menu, text= "Borrar contactos",bg = "orange")
label5= Button(Marco_menu, text= "Editar Contactos",bg = "orange")

    

# Ubicacion en pantalla principal
Marco_menu.grid(row = 4, column = 9, padx = 20, pady = 50) 
Marco_photo.grid(row = 4, column = 30, padx = 20, pady = 50)
botonB.grid(row = 5, column = 0, padx = 5 , pady = 5)
e_texto.grid(row = 5, column = 1, padx = 50, pady =5)
boton1.grid(row = 6, column = 2, padx = 5 , pady = 5)
boton2.grid(row = 6, column = 3, padx = 5 , pady = 5)

#labels ubicacion principal

label1.grid(row = 4, column = 1, padx = 5 , pady = 5)
label2.grid(row = 4, column = 2, padx = 5 , pady = 5)
label3.grid(row = 4, column = 3, padx = 5 , pady = 5)
label4.grid(row = 4, column = 4, padx = 5 , pady = 5)
label5.grid(row = 4, column = 5, padx = 5 , pady = 5)





mainloop()

